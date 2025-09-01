export * from './defillama';
export * from './velodrome';
export * from './curveAmm';
export * from './lensOracle';
export * from './erc4626';
export * from './yearnVault';

import { DefilllamaFetcher } from './defillama';
import { VelodromeFetcher } from './velodrome';
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
  private velodrome = new VelodromeFetcher();
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

    // On-chain oracles
    progressTracker.update(progressKey, priceMap.size, 'Checking on-chain oracles...');
    const handleError = () => (progressTracker.error(progressKey), new Map<string, Price>());
    
    const onChainPromises = [
      this.lensOracle.fetchPrices(chainId, missingTokens).catch(handleError),
      ...(chainId === 10 || chainId === 8453 ? 
        [this.velodrome.fetchPrices(chainId, missingTokens, priceMap).catch(handleError)] : []),
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

    // External APIs
    progressTracker.update(progressKey, priceMap.size, 'Fetching from DeFiLlama API...');
    const apiResults = await this.defillama.fetchPrices(chainId, missingTokens).catch(handleError);
    
    apiResults.forEach((price, address) => {
      if (price.price > BigInt(0) && !priceMap.has(address)) {
        priceMap.set(address, price);
        priceCache.set(chainId, address, price, symbolMap.get(address));
      }
    });
    
    progressTracker.update(progressKey, priceMap.size, 'External APIs complete');
    
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));

    // Vault pricing
    if (missingTokens.length > 0) {
      progressTracker.update(progressKey, priceMap.size, 'Checking vault prices...');
      
      const vaultFetchers = [
        () => this.erc4626.fetchPrices(chainId, missingTokens, priceMap),
        () => this.yearnVault.fetchPrices(chainId, tokens.filter(t => !priceMap.has(t.address.toLowerCase())), priceMap)
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