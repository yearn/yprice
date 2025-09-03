import { getStorage, StorageWrapper } from '../storage';
import { PriceFetcherOrchestrator } from '../fetchers';
import { ERC20Token, WETH_ADDRESSES, Price } from '../models';
import { logger } from '../utils';
import { betterLogger } from '../utils/betterLogger';
import tokenDiscoveryService from '../discovery/tokenDiscoveryService';
import { chunk } from 'lodash';
import { zeroAddress } from 'viem';

export class PriceService {
  private fetcher = new PriceFetcherOrchestrator();
  private fetchInterval: NodeJS.Timeout | null = null;
  
  // Utility method for controlled concurrent processing
  private async processBatchesConcurrently<T, R>(
    items: T[],
    maxConcurrent: number,
    processor: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = [];
    const executing: Promise<void>[] = [];
    
    for (const item of items) {
      const promise = processor(item).then(result => {
        results.push(result);
      });
      
      executing.push(promise);
      
      if (executing.length >= maxConcurrent) {
        await Promise.race(executing);
        executing.splice(executing.findIndex(p => p === promise), 1);
      }
    }
    
    await Promise.all(executing);
    return results;
  }

  async fetchAndStorePrices(
    chainId: number, 
    tokens: ERC20Token[], 
    existingPrices?: Map<string, Price>
  ): Promise<Map<string, Price>> {
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
      
      const prices = await this.fetcher.fetchPrices(chainId, tokensWithNative, existingPrices);
      const storage = new StorageWrapper(getStorage());
      
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
        await storage.storePrices(chainId, pricesArray);
      }
      
      return prices;
    } catch (error) {
      logger.error(`Error fetching prices for chain ${chainId}:`, error);
      return new Map();
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
      
      // Process chains with optimized batching
      const chainResults = await Promise.all(
        Array.from(tokensByChain.entries()).map(async ([chainId, tokens]) => {
          if (tokens.length === 0) {
            return { chainId, tokens: 0, prices: 0, errors: 0 };
          }
          
          const chainStartTime = Date.now();
          betterLogger.chainInfo(chainId, `Processing ${tokens.length} tokens...`);
          
          // Helper to determine if a token is a derivative
          const isDerivative = (token: ERC20Token): boolean => {
            const source = token.source || '';
            return source.includes('vault') || 
                   source.includes('lp') || 
                   source.includes('pool') || 
                   source === 'pendle' ||
                   source === 'gamma-lp' ||
                   source === 'curve-lp' ||
                   source === 'balancer-pool';
          };
          
          // Split tokens into base and derivative
          const baseTokens = tokens.filter(t => !isDerivative(t));
          const derivativeTokens = tokens.filter(t => isDerivative(t));
          
          betterLogger.chainInfo(chainId, `Processing ${baseTokens.length} base tokens and ${derivativeTokens.length} derivative tokens`);
          
          // Phase 1: Process all base tokens and collect prices
          const batchSize = chainId === 1 ? 100 : 150;
          const baseBatches = chunk(baseTokens, batchSize);
          const maxConcurrentBatches = 10;
          let errors = 0;
          
          // Accumulator for all base token prices
          const accumulatedPrices = new Map<string, Price>();
          
          // Process base token batches
          if (baseBatches.length > 0) {
            betterLogger.verbose(`Processing ${baseBatches.length} base token batches...`);
            
            await this.processBatchesConcurrently(
              baseBatches,
              maxConcurrentBatches,
              async (batch) => {
                try {
                  const batchPrices = await this.fetchAndStorePrices(chainId, batch);
                  // Accumulate prices
                  batchPrices.forEach((price, address) => {
                    accumulatedPrices.set(address, price);
                  });
                  return { success: true };
                } catch (error) {
                  errors++;
                  betterLogger.verbose(`Error in base batch for chain ${chainId}: ${error}`);
                  return { success: false, error };
                }
              }
            );
          }
          
          // Phase 2: Process derivative tokens with all base prices available
          const derivativeBatches = chunk(derivativeTokens, batchSize);
          
          if (derivativeBatches.length > 0) {
            betterLogger.verbose(`Processing ${derivativeBatches.length} derivative token batches with ${accumulatedPrices.size} base prices...`);
            
            await this.processBatchesConcurrently(
              derivativeBatches,
              maxConcurrentBatches,
              async (batch) => {
                try {
                  // Pass accumulated prices to derivative processing
                  await this.fetchAndStorePrices(chainId, batch, accumulatedPrices);
                  return { success: true };
                } catch (error) {
                  errors++;
                  betterLogger.verbose(`Error in derivative batch for chain ${chainId}: ${error}`);
                  return { success: false, error };
                }
              }
            );
          }
          
          // Get final price count after all batches complete
          const storage = new StorageWrapper(getStorage());
          const { asSlice } = await storage.listPrices(chainId);
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