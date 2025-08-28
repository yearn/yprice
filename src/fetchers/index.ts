export * from './defillama';
export * from './coingecko';
export * from './velodrome';
export * from './curveAmm';
export * from './lensOracle';
export * from './erc4626';
export * from './yearnVault';

import { DefilllamaFetcher } from './defillama';
import { CoingeckoFetcher } from './coingecko';
import { VelodromeFetcher } from './velodrome';
import { CurveAmmFetcher } from './curveAmm';
import { LensOracleFetcher } from './lensOracle';
import { ERC4626Fetcher } from './erc4626';
import { YearnVaultFetcher } from './yearnVault';
import { ERC20Token, Price } from '../models';
import { logger } from '../utils';
import { priceCache } from '../utils/priceCache';
import { partition, forEach, filter } from 'lodash';

export class PriceFetcherOrchestrator {
  private defillama = new DefilllamaFetcher();
  private coingecko = new CoingeckoFetcher();
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
    logger.info(`Fetching prices for ${tokens.length} tokens on chain ${chainId}`);
    
    const symbolMap = new Map<string, string>();
    forEach(tokens, t => symbolMap.set(t.address.toLowerCase(), t.symbol));

    const cachedPrices = priceCache.getMany(chainId, tokens.map(t => t.address));
    forEach(Array.from(cachedPrices.entries()), ([address, price]) => {
      priceMap.set(address, price);
    });
    
    let missingTokens = filter(tokens, t => !priceMap.has(t.address.toLowerCase()));
    
    if (cachedPrices.size > 0) {
      logger.info(`Cache returned ${cachedPrices.size} prices, ${missingTokens.length} remaining`);
    }
    
    if (missingTokens.length === 0) return priceMap;

    const onChainPromises = [
      this.lensOracle.fetchPrices(chainId, missingTokens)
        .catch(err => {
          logger.error('Lens Oracle failed:', err);
          return new Map<string, Price>();
        }),
      ...(chainId === 10 || chainId === 8453 ? [
        this.velodrome.fetchPrices(chainId, missingTokens, priceMap)
          .catch(err => {
            logger.error('Velodrome failed:', err);
            return new Map<string, Price>();
          })
      ] : []),
      this.curveAmm.fetchPrices(chainId, missingTokens, priceMap)
        .catch(err => {
          logger.error('Curve AMM failed:', err);
          return new Map<string, Price>();
        })
    ];
    
    const onChainResults = await Promise.all(onChainPromises);
    forEach(onChainResults, result => {
      forEach(Array.from(result.entries()), ([address, price]) => {
        if (price.price > BigInt(0) && !priceMap.has(address)) {
          priceMap.set(address, price);
          priceCache.set(chainId, address, price, symbolMap.get(address));
        }
      });
    });
    
    missingTokens = filter(tokens, t => !priceMap.has(t.address.toLowerCase()));
    
    if (missingTokens.length === 0) {
      logger.info(`On-chain oracles resolved all prices`);
      return priceMap;
    }

    const apiResults = await Promise.all([
      this.defillama.fetchPrices(chainId, missingTokens)
        .catch(err => {
          logger.error('DeFiLlama failed:', err);
          return new Map<string, Price>();
        }),
      this.coingecko.fetchPrices(chainId, missingTokens)
        .catch(err => {
          logger.error('CoinGecko failed:', err);
          return new Map<string, Price>();
        })
    ]);
    
    forEach(apiResults, result => {
      forEach(Array.from(result.entries()), ([address, price]) => {
        if (price.price > BigInt(0) && !priceMap.has(address)) {
          priceMap.set(address, price);
          priceCache.set(chainId, address, price, symbolMap.get(address));
        }
      });
    });
    
    missingTokens = filter(tokens, t => !priceMap.has(t.address.toLowerCase()));

    if (missingTokens.length > 0) {
      try {
        const erc4626Prices = await this.erc4626.fetchPrices(chainId, missingTokens, priceMap);
        forEach(Array.from(erc4626Prices.entries()), ([address, price]) => {
          if (price.price > BigInt(0)) {
            priceMap.set(address, price);
            priceCache.set(chainId, address, price, symbolMap.get(address));
          }
        });
        
        if (erc4626Prices.size > 0) {
          logger.info(`ERC4626 returned ${erc4626Prices.size} vault prices`);
        }
      } catch (error) {
        logger.error('ERC4626 fetcher failed:', error);
      }
    }

    missingTokens = filter(tokens, t => !priceMap.has(t.address.toLowerCase()));

    if (missingTokens.length > 0) {
      try {
        const vaultPrices = await this.yearnVault.fetchPrices(chainId, missingTokens, priceMap);
        forEach(Array.from(vaultPrices.entries()), ([address, price]) => {
          if (price.price > BigInt(0)) {
            priceMap.set(address, price);
            priceCache.set(chainId, address, price, symbolMap.get(address));
          }
        });
        
        if (vaultPrices.size > 0) {
          logger.info(`Yearn Vault returned ${vaultPrices.size} vault prices`);
        }
      } catch (error) {
        logger.error('Yearn Vault fetcher failed:', error);
      }
    }

    const finalMissing = filter(tokens, t => !priceMap.has(t.address.toLowerCase()));
    logger.info(`Total prices fetched: ${priceMap.size}/${tokens.length}`);
    if (finalMissing.length > 0) {
      logger.debug(`Still missing prices for ${finalMissing.length} tokens`);
    }
    
    return priceMap;
  }
}

export default new PriceFetcherOrchestrator();