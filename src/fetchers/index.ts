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
    tokens: ERC20Token[]
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>();
    const progressKey = `fetch-${chainId}-${Date.now()}`;
    
    progressTracker.start(progressKey, 'Price Fetching', tokens.length, chainId);
    
    const symbolMap = new Map<string, string>();
    tokens.forEach(t => symbolMap.set(t.address.toLowerCase(), t.symbol));

    // Cache check
    const cachedPrices = priceCache.getMany(chainId, tokens.map(t => t.address));
    cachedPrices.forEach((price, address) => priceMap.set(address, price));
    
    progressTracker.update(progressKey, priceMap.size, `${cachedPrices.size} from cache`);
    
    let missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));
    
    if (missingTokens.length === 0) {
      progressTracker.complete(progressKey);
      return priceMap;
    }

    const handleError = () => (progressTracker.error(progressKey), new Map<string, Price>());
    
    // Step 1: External APIs (fastest, most reliable)
    progressTracker.update(progressKey, priceMap.size, 'Fetching from external APIs...');
    
    // DeFiLlama first
    const defillamaResults = await this.defillama.fetchPrices(chainId, missingTokens).catch(handleError);
    defillamaResults.forEach((price, address) => {
      if (price.price > BigInt(0) && !priceMap.has(address)) {
        // Skip known incorrect prices from DeFiLlama
        if (chainId === 1 && address === '0x27b5739e22ad9033bcbf192059122d163b60349d') {
          // st-yCRV has incorrect price on DeFiLlama
          return;
        }
        if (chainId === 1 && address === '0x69833361991ed76f9e8dbbcdf9ea1520febfb4a7') {
          // st-ETH has incorrect price on DeFiLlama
          return;
        }
        priceMap.set(address, price);
        priceCache.set(chainId, address, price, symbolMap.get(address));
      }
    });
    
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));
    if (missingTokens.length === 0) {
      progressTracker.complete(progressKey);
      return priceMap;
    }
    
    // Curve Factories API
    const curveFactoriesResults = await this.curveFactories.fetchPrices(chainId, missingTokens).catch(handleError);
    curveFactoriesResults.forEach((price, address) => {
      if (price.price > BigInt(0) && !priceMap.has(address)) {
        priceMap.set(address, price);
        priceCache.set(chainId, address, price, symbolMap.get(address));
      }
    });
    
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));
    if (missingTokens.length === 0) {
      progressTracker.complete(progressKey);
      return priceMap;
    }
    
    // Protocol-specific APIs
    const protocolApis = [
      this.gamma.fetchPrices(chainId, missingTokens).catch(handleError),
      this.pendle.fetchPrices(chainId, missingTokens).catch(handleError)
    ];
    
    const protocolResults = await Promise.all(protocolApis);
    protocolResults.forEach(result => 
      result.forEach((price, address) => {
        if (price.price > BigInt(0) && !priceMap.has(address)) {
          priceMap.set(address, price);
          priceCache.set(chainId, address, price, symbolMap.get(address));
        }
      })
    );
    
    progressTracker.update(progressKey, priceMap.size, 'External APIs complete');
    
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));
    if (missingTokens.length === 0) {
      progressTracker.complete(progressKey);
      return priceMap;
    }
    
    // Step 2: On-chain oracles (slower, but reliable for remaining tokens)
    progressTracker.update(progressKey, priceMap.size, 'Checking on-chain oracles...');
    
    const onChainPromises = [
      ...(chainId === 10 || chainId === 8453 ? 
        [this.velodrome.fetchPrices(chainId, missingTokens, priceMap).catch(handleError)] : []),
      this.lensOracle.fetchPrices(chainId, missingTokens).catch(handleError),
      this.curveAmm.fetchPrices(chainId, missingTokens, priceMap).catch(handleError)
    ];
    
    const onChainResults = await Promise.all(onChainPromises);
    onChainResults.forEach(result => 
      result.forEach((price, address) => {
        if (price.price > BigInt(0) && !priceMap.has(address)) {
          priceMap.set(address, price);
          priceCache.set(chainId, address, price, symbolMap.get(address));
        }
      })
    );
    
    progressTracker.update(progressKey, priceMap.size, 'On-chain oracles complete');
    
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));
    if (missingTokens.length === 0) {
      progressTracker.complete(progressKey);
      return priceMap;
    }

    // Step 3: Vault pricing (for wrapped/yield-bearing tokens)
    progressTracker.update(progressKey, priceMap.size, 'Checking vault prices...');
    
    const vaultFetchers = [
      () => this.erc4626.fetchPrices(chainId, missingTokens, priceMap),
      () => this.yearnVault.fetchPrices(chainId, missingTokens, priceMap)
    ];
    
    for (const fetcher of vaultFetchers) {
      try {
        const vaultPrices = await fetcher();
        vaultPrices.forEach((price, address) => {
          if (price.price > BigInt(0)) {
            priceMap.set(address, price);
            priceCache.set(chainId, address, price, symbolMap.get(address));
          }
        });
      } catch { progressTracker.error(progressKey); }
    }

    progressTracker.complete(progressKey);
    
    const finalMissing = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));
    if (finalMissing.length > 0) {
      logger.debug(`Missing prices for ${finalMissing.length} tokens on chain ${chainId}`);
    }
    
    return priceMap;
  }
}

export default new PriceFetcherOrchestrator();