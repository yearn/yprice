export * from './defillama';
export * from './velodrome';
export * from './curveAmm';
export * from './curveFactories';
export * from './gamma';
export * from './pendle';
export * from './lensOracle';
export * from './erc4626';
export * from './yearnVault';

import { DefilllamaFetcher } from './defillama';
import { CurveFactoriesFetcher } from './curveFactories';
import { VelodromeFetcher } from './velodrome';
import { GammaFetcher } from './gamma';
import { PendleFetcher } from './pendle';
import { CurveAmmFetcher } from './curveAmm';
import { LensOracleFetcher } from './lensOracle';
import { ERC4626Fetcher } from './erc4626';
import { YearnVaultFetcher } from './yearnVault';
import { ERC20Token, Price } from '../models';
import { logger } from '../utils';
import { priceCache } from '../utils/priceCache';
import { progressTracker } from '../utils/progressTracker';

export class PriceFetcherOrchestrator {
  private defillama = new DefilllamaFetcher();
  private curveFactories = new CurveFactoriesFetcher();
  private velodrome = new VelodromeFetcher();
  private gamma = new GammaFetcher();
  private pendle = new PendleFetcher();
  private curveAmm = new CurveAmmFetcher();
  private lensOracle = new LensOracleFetcher();
  private erc4626 = new ERC4626Fetcher();
  private yearnVault = new YearnVaultFetcher();

  async fetchPrices(
    chainId: number, 
    tokens: ERC20Token[],
    existingPrices?: Map<string, Price>
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>();
    const progressKey = `fetch-${chainId}-${Date.now()}`;
    
    progressTracker.start(progressKey, 'Price Fetching', tokens.length, chainId);
    
    // Initialize with existing prices if provided
    if (existingPrices) {
      existingPrices.forEach((price, address) => {
        priceMap.set(address, price);
      });
    }
    
    const symbolMap = new Map<string, string>();
    tokens.forEach(t => symbolMap.set(t.address.toLowerCase(), t.symbol));

    // Cache check
    const cachedPrices = priceCache.getMany(chainId, tokens.map(t => t.address));
    cachedPrices.forEach((price, address) => priceMap.set(address, price));
    
    progressTracker.update(progressKey, priceMap.size, `${cachedPrices.size} from cache${existingPrices ? ` + ${existingPrices.size} existing` : ''}`);
    
    let missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));
    
    if (missingTokens.length === 0) {
      progressTracker.complete(progressKey);
      return priceMap;
    }

    const handleError = (error: any) => {
      logger.debug(`Fetcher error: ${error.message || 'Unknown error'}`);
      return new Map<string, Price>();
    };
    
    // Run all independent fetchers in parallel
    progressTracker.update(progressKey, priceMap.size, 'Fetching prices from all sources...');
    
    // Known incorrect prices to skip from DeFiLlama
    const skipDefillamaAddresses = new Set([
      chainId === 1 ? '0x27b5739e22ad9033bcbf192059122d163b60349d' : '', // st-yCRV
      chainId === 1 ? '0x69833361991ed76f9e8dbbcdf9ea1520febfb4a7' : ''  // st-ETH
    ].filter(Boolean));
    
    // All price fetchers that don't depend on other prices
    const independentFetchers = [
      // External APIs
      this.defillama.fetchPrices(chainId, missingTokens)
        .then(results => {
          const filtered = new Map();
          results.forEach((price, address) => {
            if (!skipDefillamaAddresses.has(address)) {
              filtered.set(address, price);
            }
          });
          return filtered;
        })
        .catch(handleError),
      this.curveFactories.fetchPrices(chainId, missingTokens).catch(handleError),
      this.gamma.fetchPrices(chainId, missingTokens).catch(handleError),
      this.pendle.fetchPrices(chainId, missingTokens).catch(handleError),
      
      // On-chain oracles
      this.lensOracle.fetchPrices(chainId, missingTokens).catch(handleError),
    ];
    
    // Chain-specific fetchers
    if (chainId === 10 || chainId === 8453) {
      // Velodrome needs priceMap for reference prices
      independentFetchers.push(
        this.velodrome.fetchPrices(chainId, missingTokens, new Map()).catch(handleError)
      );
    }
    
    // Run all independent fetchers concurrently
    const results = await Promise.allSettled(independentFetchers);
    
    // Process results and update price map
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        result.value.forEach((price, address) => {
          if (price.price > BigInt(0) && !priceMap.has(address)) {
            priceMap.set(address, price);
            priceCache.set(chainId, address, price, symbolMap.get(address));
          }
        });
      }
    });
    
    progressTracker.update(progressKey, priceMap.size, 'Independent fetchers complete');
    
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));
    if (missingTokens.length === 0) {
      progressTracker.complete(progressKey);
      return priceMap;
    }
    
    // Dependent fetchers (need existing prices)
    progressTracker.update(progressKey, priceMap.size, 'Running dependent fetchers...');
    
    const dependentFetchers = [
      // CurveAmm needs priceMap for LP calculations
      this.curveAmm.fetchPrices(chainId, missingTokens, priceMap).catch(handleError),
      // Vault fetchers need underlying token prices
      this.erc4626.fetchPrices(chainId, missingTokens, priceMap).catch(handleError),
      this.yearnVault.fetchPrices(chainId, missingTokens, priceMap).catch(handleError)
    ];
    
    // If Velodrome needs existing prices, run it in the dependent phase
    if ((chainId === 10 || chainId === 8453) && priceMap.size > 0) {
      dependentFetchers.push(
        this.velodrome.fetchPrices(chainId, missingTokens, priceMap).catch(handleError)
      );
    }
    
    const dependentResults = await Promise.allSettled(dependentFetchers);
    
    // Process dependent results
    dependentResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        result.value.forEach((price, address) => {
          if (price.price > BigInt(0) && !priceMap.has(address)) {
            priceMap.set(address, price);
            priceCache.set(chainId, address, price, symbolMap.get(address));
          }
        });
      }
    });

    progressTracker.complete(progressKey);
    
    const finalMissing = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));
    if (finalMissing.length > 0) {
      logger.debug(`Missing prices for ${finalMissing.length} tokens on chain ${chainId}`);
    }
    
    return priceMap;
  }
}

export default new PriceFetcherOrchestrator();