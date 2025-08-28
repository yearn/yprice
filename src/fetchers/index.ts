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

export class PriceFetcherOrchestrator {
  private defillama: DefilllamaFetcher;
  private coingecko: CoingeckoFetcher;
  private velodrome: VelodromeFetcher;
  private curveAmm: CurveAmmFetcher;
  private lensOracle: LensOracleFetcher;
  private erc4626: ERC4626Fetcher;
  private yearnVault: YearnVaultFetcher;

  constructor() {
    this.defillama = new DefilllamaFetcher();
    this.coingecko = new CoingeckoFetcher();
    this.velodrome = new VelodromeFetcher();
    this.curveAmm = new CurveAmmFetcher();
    this.lensOracle = new LensOracleFetcher();
    this.erc4626 = new ERC4626Fetcher();
    this.yearnVault = new YearnVaultFetcher();
  }

  async fetchPrices(
    chainId: number, 
    tokens: ERC20Token[]
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>();

    logger.info(`Fetching prices for ${tokens.length} tokens on chain ${chainId}`);

    // Track which tokens still need prices
    let missingTokens = [...tokens];
    
    // Build symbol map for caching
    const symbolMap = new Map<string, string>();
    tokens.forEach(t => symbolMap.set(t.address.toLowerCase(), t.symbol));

    /**
     * Optimized order - check cache and on-chain sources first:
     * 1. Cache check (immediate)
     * 2. On-chain oracles in parallel (Lens, Velodrome, Curve AMM)
     * 3. External APIs only if needed (DeFiLlama, CoinGecko)
     * 4. Vault/Complex pricing (ERC4626, Yearn)
     */

    // 1. Check cache first
    const cachedPrices = priceCache.getMany(chainId, tokens.map(t => t.address));
    cachedPrices.forEach((price, address) => {
      priceMap.set(address, price);
    });
    
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));
    
    if (cachedPrices.size > 0) {
      logger.info(`Cache returned ${cachedPrices.size} prices, ${missingTokens.length} remaining`);
    }
    
    if (missingTokens.length === 0) {
      return priceMap;
    }

    // 2. Try on-chain oracles in parallel (faster than external APIs)
    const onChainPromises: Promise<Map<string, Price>>[] = [];
    
    // Lens Oracle
    onChainPromises.push(
      this.lensOracle.fetchPrices(chainId, missingTokens)
        .catch(err => {
          logger.error('Lens Oracle failed:', err);
          return new Map<string, Price>();
        })
    );
    
    // Velodrome/Aerodrome for Optimism/Base
    if (chainId === 10 || chainId === 8453) {
      onChainPromises.push(
        this.velodrome.fetchPrices(chainId, missingTokens, priceMap)
          .catch(err => {
            logger.error('Velodrome failed:', err);
            return new Map<string, Price>();
          })
      );
    }
    
    // Curve AMM Oracle
    onChainPromises.push(
      this.curveAmm.fetchPrices(chainId, missingTokens, priceMap)
        .catch(err => {
          logger.error('Curve AMM failed:', err);
          return new Map<string, Price>();
        })
    );
    
    // Execute all on-chain fetches in parallel
    const onChainResults = await Promise.all(onChainPromises);
    onChainResults.forEach(result => {
      result.forEach((price, address) => {
        if (price.price > BigInt(0) && !priceMap.has(address)) {
          priceMap.set(address, price);
          priceCache.set(chainId, address, price, symbolMap.get(address));
        }
      });
    });
    
    // Update missing tokens
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));
    
    if (missingTokens.length === 0) {
      logger.info(`On-chain oracles resolved all prices`);
      return priceMap;
    }

    // 3. Try external APIs in parallel (DeFiLlama + CoinGecko)
    const apiPromises: Promise<Map<string, Price>>[] = [];
    
    // DeFiLlama
    apiPromises.push(
      this.defillama.fetchPrices(chainId, missingTokens)
        .catch(err => {
          logger.error('DeFiLlama failed:', err);
          return new Map<string, Price>();
        })
    );
    
    // CoinGecko
    apiPromises.push(
      this.coingecko.fetchPrices(chainId, missingTokens)
        .catch(err => {
          logger.error('CoinGecko failed:', err);
          return new Map<string, Price>();
        })
    );
    
    // Execute both API calls in parallel
    const apiResults = await Promise.all(apiPromises);
    apiResults.forEach(result => {
      result.forEach((price, address) => {
        if (price.price > BigInt(0) && !priceMap.has(address)) {
          priceMap.set(address, price);
          priceCache.set(chainId, address, price, symbolMap.get(address));
        }
      });
    });


    // Update missing tokens list
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));

    // 4. Complex vault pricing (needs underlying prices from above)
    if (missingTokens.length > 0) {
      try {
        const erc4626Prices = await this.erc4626.fetchPrices(chainId, missingTokens, priceMap);
        erc4626Prices.forEach((price, address) => {
          if (price.price > BigInt(0)) {
            priceMap.set(address, price);
          }
        });
        if (erc4626Prices.size > 0) {
          logger.info(`ERC4626 returned ${erc4626Prices.size} vault prices`);
          // Cache vault prices
          erc4626Prices.forEach((price, address) => {
            priceCache.set(chainId, address, price, symbolMap.get(address));
          });
        }
      } catch (error) {
        logger.error('ERC4626 fetcher failed:', error);
      }
    }

    // Update missing tokens list
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));

    // 5. Yearn Vault pricing
    if (missingTokens.length > 0) {
      try {
        const vaultPrices = await this.yearnVault.fetchPrices(chainId, missingTokens, priceMap);
        vaultPrices.forEach((price, address) => {
          if (price.price > BigInt(0)) {
            priceMap.set(address, price);
          }
        });
        if (vaultPrices.size > 0) {
          logger.info(`Yearn Vault returned ${vaultPrices.size} vault prices`);
          // Cache vault prices
          vaultPrices.forEach((price, address) => {
            priceCache.set(chainId, address, price, symbolMap.get(address));
          });
        }
      } catch (error) {
        logger.error('Yearn Vault fetcher failed:', error);
      }
    }

    // Final stats
    const finalMissing = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));
    logger.info(`Total prices fetched: ${priceMap.size}/${tokens.length}`);
    if (finalMissing.length > 0) {
      logger.debug(`Still missing prices for ${finalMissing.length} tokens`);
    }
    
    return priceMap;
  }
}

export default new PriceFetcherOrchestrator();