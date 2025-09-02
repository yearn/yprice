import { getPriceStorage } from '../storage';
import { PriceFetcherOrchestrator } from '../fetchers';
import { ERC20Token, WETH_ADDRESSES } from '../models';
import { logger } from '../utils';
import { betterLogger } from '../utils/betterLogger';
import tokenDiscoveryService from '../discovery/tokenDiscoveryService';
import { chunk } from 'lodash';
import { zeroAddress } from 'viem';

export class PriceService {
  private fetcher = new PriceFetcherOrchestrator();
  private fetchInterval: NodeJS.Timeout | null = null;

  async fetchAndStorePrices(chainId: number, tokens: ERC20Token[]): Promise<void> {
    try {
      const tokensWithNative = [...tokens];
      const wethAddress = WETH_ADDRESSES[chainId];
      
      if (wethAddress && !tokensWithNative.some(t => t.address.toLowerCase() === wethAddress)) {
        tokensWithNative.push({
          address: wethAddress,
          name: 'Wrapped Ether',
          symbol: 'WETH',
          decimals: 18,
          chainId,
        });
      }
      
      const prices = await this.fetcher.fetchPrices(chainId, tokensWithNative);
      const storage = getPriceStorage();
      
      if (wethAddress) {
        const wethPrice = prices.get(wethAddress);
        if (wethPrice) {
          prices.set(zeroAddress, {
            ...wethPrice,
            address: zeroAddress,
          });
        }
      }
      
      const pricesArray = Array.from(prices.values());
      if (pricesArray.length > 0) {
        storage.storePrices(chainId, pricesArray);
      }
    } catch (error) {
      logger.error(`Error fetching prices for chain ${chainId}:`, error);
    }
  }

  async fetchDiscoveredTokens(forceRefresh: boolean = false): Promise<void> {
    try {
      const startTime = Date.now();
      const tokensByChain = await tokenDiscoveryService.discoverAllTokens(forceRefresh);
      
      const totalTokens = Array.from(tokensByChain.values()).reduce((sum, tokens) => sum + tokens.length, 0);
      const totalChains = tokensByChain.size;
      
      logger.info('');
      logger.info('📈 Starting price fetching...');
      logger.info(`Processing ${totalTokens} tokens across ${totalChains} chains`);
      logger.info('');
      
      // Enable batch mode to suppress verbose logs
      betterLogger.setBatchMode(true);
      
      // Track overall stats
      let totalPricesFound = 0;
      let totalErrors = 0;
      
      // Process chains with cleaner logging
      const chainResults = await Promise.all(
        Array.from(tokensByChain.entries()).map(async ([chainId, tokens]) => {
          if (tokens.length === 0) {
            return { chainId, tokens: 0, prices: 0, errors: 0 };
          }
          
          const chainStartTime = Date.now();
          betterLogger.chainInfo(chainId, `Processing ${tokens.length} tokens...`);
          
          const batchSize = 500;
          const batches = chunk(tokens, batchSize);
          let errors = 0;
          
          // Process in smaller concurrent groups
          const batchGroups = chunk(batches, 3);
          for (const batchGroup of batchGroups) {
            await Promise.all(
              batchGroup.map(async batch => {
                try {
                  await this.fetchAndStorePrices(chainId, batch);
                } catch (error) {
                  errors++;
                  betterLogger.verbose(`Error in batch for chain ${chainId}: ${error}`);
                }
              })
            );
            
            // Small delay between batch groups
            if (batchGroups.indexOf(batchGroup) < batchGroups.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
          
          // Get final price count after all batches complete
          const storage = getPriceStorage();
          const { asSlice } = storage.listPrices(chainId);
          const pricesFound = asSlice.length;
          
          const chainDuration = Date.now() - chainStartTime;
          betterLogger.chainComplete(chainId, tokens.length, pricesFound, chainDuration);
          
          return { chainId, tokens: tokens.length, prices: pricesFound, errors };
        })
      );
      
      // Disable batch mode
      betterLogger.setBatchMode(false);
      
      // Calculate totals
      chainResults.forEach(result => {
        totalPricesFound += result.prices;
        totalErrors += result.errors;
      });
      
      // Show summary
      betterLogger.summary({
        totalChains,
        totalTokens,
        totalPrices: totalPricesFound,
        duration: Date.now() - startTime,
        errors: totalErrors
      });
      
    } catch (error) {
      betterLogger.setBatchMode(false);
      logger.error('Error fetching discovered tokens:', error);
    }
  }

  startPeriodicFetch(intervalMs: number = 60000): void {
    logger.info(`🚀 Starting price service (interval: ${intervalMs/1000}s)`);
    
    this.fetchDiscoveredTokens(true).catch(error => {
      logger.error('Error in initial price fetch:', error);
    });

    this.fetchInterval = setInterval(() => {
      const shouldRediscover = Date.now() % 3600000 < intervalMs;
      this.fetchDiscoveredTokens(shouldRediscover).catch(error => {
        logger.error('Error in periodic price fetch:', error);
      });
    }, intervalMs);
  }

  stopPeriodicFetch(): void {
    if (this.fetchInterval) {
      clearInterval(this.fetchInterval);
      this.fetchInterval = null;
      logger.info('⏹️ Stopped periodic price fetching');
    }
  }

  setVerboseLogging(verbose: boolean): void {
    logger.info(`Verbose logging ${verbose ? 'enabled' : 'disabled'}`);
  }

  async fetchOnce(): Promise<void> {
    logger.info('🔄 Starting one-time price refresh...');
    try {
      await this.fetchDiscoveredTokens(true);
      logger.info('✅ Price refresh completed successfully');
    } catch (error) {
      logger.error('❌ Price refresh failed:', error);
      throw error;
    }
  }
}

export default new PriceService();