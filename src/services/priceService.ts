import { getPriceStorage } from '../storage';
import { PriceFetcherOrchestrator } from '../fetchers';
import { ERC20Token } from '../models';
import { logger } from '../utils';
import tokenDiscoveryService from '../discovery/tokenDiscoveryService';

export class PriceService {
  private fetcher: PriceFetcherOrchestrator;
  private fetchInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    this.fetcher = new PriceFetcherOrchestrator();
  }

  async fetchAndStorePrices(chainId: number, tokens: ERC20Token[]): Promise<void> {
    try {
      logger.info(`Fetching prices for chain ${chainId} with ${tokens.length} tokens`);
      
      // Add native ETH token (0x0000...0000) for chains that support it
      const tokensWithNative = [...tokens];
      if (chainId === 1 || chainId === 10 || chainId === 42161 || chainId === 8453) {
        // Check if we have WETH in the list
        const wethAddresses = {
          1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          10: '0x4200000000000000000000000000000000000006',
          42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
          8453: '0x4200000000000000000000000000000000000006',
        };
        
        const wethAddress = wethAddresses[chainId as keyof typeof wethAddresses];
        if (wethAddress && !tokensWithNative.some(t => t.address.toLowerCase() === wethAddress)) {
          tokensWithNative.push({
            address: wethAddress,
            name: 'Wrapped Ether',
            symbol: 'WETH',
            decimals: 18,
            chainId,
          });
        }
      }
      
      const prices = await this.fetcher.fetchPrices(chainId, tokensWithNative);
      const storage = getPriceStorage();
      
      // Add native ETH price (same as WETH)
      if (chainId === 1 || chainId === 10 || chainId === 42161 || chainId === 8453) {
        const wethAddresses = {
          1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          10: '0x4200000000000000000000000000000000000006',
          42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
          8453: '0x4200000000000000000000000000000000000006',
        };
        
        const wethAddress = wethAddresses[chainId as keyof typeof wethAddresses];
        const wethPrice = prices.get(wethAddress!);
        if (wethPrice) {
          // Add native ETH with zero address
          prices.set('0x0000000000000000000000000000000000000000', {
            ...wethPrice,
            address: '0x0000000000000000000000000000000000000000',
          });
        }
      }
      
      const pricesArray = Array.from(prices.values());
      if (pricesArray.length > 0) {
        storage.storePrices(chainId, pricesArray);
        logger.info(`Stored ${pricesArray.length} prices for chain ${chainId}`);
      }
    } catch (error) {
      logger.error(`Error fetching prices for chain ${chainId}:`, error);
    }
  }

  async fetchDiscoveredTokens(forceRefresh: boolean = false): Promise<void> {
    try {
      // Discover all tokens from various sources
      logger.info('Discovering tokens from all sources...');
      const tokensByChain = await tokenDiscoveryService.discoverAllTokens(forceRefresh);
      
      const chainCounts = tokenDiscoveryService.getChainTokenCounts();
      logger.info('Token discovery complete:', chainCounts);
      
      // Fetch prices for discovered tokens on each chain IN PARALLEL
      const chainPromises = Array.from(tokensByChain.entries()).map(async ([chainId, tokens]) => {
        if (tokens.length > 0) {
          // Process in larger batches with better parallelization
          const batchSize = 500; // Increased from 100
          const batches: ERC20Token[][] = [];
          
          for (let i = 0; i < tokens.length; i += batchSize) {
            batches.push(tokens.slice(i, i + batchSize));
          }
          
          // Process batches with controlled concurrency (3 batches at a time)
          const batchLimit = 3;
          for (let i = 0; i < batches.length; i += batchLimit) {
            const batchGroup = batches.slice(i, i + batchLimit);
            
            // Process batch group in parallel
            await Promise.all(
              batchGroup.map(batch => this.fetchAndStorePrices(chainId, batch))
            );
            
            // Minimal delay only between batch groups
            if (i + batchLimit < batches.length) {
              await new Promise(resolve => setTimeout(resolve, 200)); // Reduced from 1000ms
            }
          }
        }
      });
      
      // Process all chains in parallel
      await Promise.all(chainPromises);
      
      logger.info(`Total tokens with prices: ${tokenDiscoveryService.getTotalTokenCount()}`);
    } catch (error) {
      logger.error('Error fetching discovered tokens:', error);
    }
  }

  startPeriodicFetch(intervalMs: number = 60000): void {
    // Initial fetch with token discovery
    this.fetchDiscoveredTokens(true).catch(error => {
      logger.error('Error in initial price fetch:', error);
    });

    // Set up periodic fetching
    this.fetchInterval = setInterval(() => {
      // Re-discover tokens every hour, just fetch prices otherwise
      const shouldRediscover = Date.now() % 3600000 < intervalMs;
      this.fetchDiscoveredTokens(shouldRediscover).catch(error => {
        logger.error('Error in periodic price fetch:', error);
      });
    }, intervalMs);

    logger.info(`Started periodic price fetching every ${intervalMs/1000} seconds`);
  }

  stopPeriodicFetch(): void {
    if (this.fetchInterval) {
      clearInterval(this.fetchInterval);
      this.fetchInterval = null;
      logger.info('Stopped periodic price fetching');
    }
  }
}

export default new PriceService();