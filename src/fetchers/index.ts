export * from './defillama';
export * from './coingecko';
export * from './curveAmm';
export * from './lensOracle';
export * from './erc4626';
export * from './yearnVault';

import { DefilllamaFetcher } from './defillama';
import { CoingeckoFetcher } from './coingecko';
import { CurveAmmFetcher } from './curveAmm';
import { LensOracleFetcher } from './lensOracle';
import { ERC4626Fetcher } from './erc4626';
import { YearnVaultFetcher } from './yearnVault';
import { ERC20Token, Price } from '../models';
import { logger } from '../utils';

export class PriceFetcherOrchestrator {
  private defillama: DefilllamaFetcher;
  private coingecko: CoingeckoFetcher;
  private curveAmm: CurveAmmFetcher;
  private lensOracle: LensOracleFetcher;
  private erc4626: ERC4626Fetcher;
  private yearnVault: YearnVaultFetcher;

  constructor() {
    this.defillama = new DefilllamaFetcher();
    this.coingecko = new CoingeckoFetcher();
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

    /**
     * Following ydaemon's exact order:
     * 1. DeFiLlama
     * 2. CoinGecko
     * 3. Curve Factories API (handled by discovery, prices via DeFiLlama/CoinGecko)
     * 4. Velo/Aero Oracles (handled by discovery, prices via DeFiLlama/CoinGecko)
     * 5. Curve AMM Oracle
     * 6. Gamma API (handled by discovery, prices via DeFiLlama/CoinGecko)
     * 7. Pendle API (handled by discovery, prices via DeFiLlama/CoinGecko)
     * 8. Lens Oracle
     * 9. Vault Price Per Share from ERC4626 standard
     * 10. Vault Price Per Share from Vault (cached) - using yearnVault
     * 11. Vault Price Per Share from Vault (live) - using yearnVault
     */

    // 1. DeFiLlama (primary source)
    try {
      const llamaPrices = await this.defillama.fetchPrices(chainId, tokens);
      llamaPrices.forEach((price, address) => {
        if (price.price > BigInt(0)) {
          priceMap.set(address, price);
        }
      });
      logger.info(`DeFiLlama returned ${llamaPrices.size} prices`);
    } catch (error) {
      logger.error('DeFiLlama fetcher failed:', error);
    }

    // Update missing tokens list
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));

    // 2. CoinGecko (secondary source)
    if (missingTokens.length > 0) {
      try {
        const geckoPrices = await this.coingecko.fetchPrices(chainId, missingTokens);
        geckoPrices.forEach((price, address) => {
          if (price.price > BigInt(0)) {
            priceMap.set(address, price);
          }
        });
        logger.info(`CoinGecko returned ${geckoPrices.size} prices`);
      } catch (error) {
        logger.error('CoinGecko fetcher failed:', error);
      }
    }

    // 3-4. Curve Factories & Velo/Aero handled by token discovery
    // Their tokens get prices from DeFiLlama/CoinGecko above

    // Update missing tokens list
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));

    // 5. Curve AMM Oracle (for Curve LP tokens)
    if (missingTokens.length > 0) {
      try {
        const curveAmmPrices = await this.curveAmm.fetchPrices(chainId, missingTokens, priceMap);
        curveAmmPrices.forEach((price, address) => {
          if (price.price > BigInt(0)) {
            priceMap.set(address, price);
          }
        });
        if (curveAmmPrices.size > 0) {
          logger.info(`Curve AMM returned ${curveAmmPrices.size} prices`);
        }
      } catch (error) {
        logger.error('Curve AMM fetcher failed:', error);
      }
    }

    // 6-7. Gamma & Pendle handled by token discovery
    // Their tokens get prices from DeFiLlama/CoinGecko above

    // Update missing tokens list
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));

    // 8. Lens Oracle
    if (missingTokens.length > 0) {
      try {
        const lensPrices = await this.lensOracle.fetchPrices(chainId, missingTokens);
        lensPrices.forEach((price, address) => {
          if (price.price > BigInt(0)) {
            priceMap.set(address, price);
          }
        });
        if (lensPrices.size > 0) {
          logger.info(`Lens Oracle returned ${lensPrices.size} prices`);
        }
      } catch (error) {
        logger.error('Lens Oracle fetcher failed:', error);
      }
    }

    // Update missing tokens list
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));

    // 9. ERC4626 Vaults (needs underlying prices)
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
        }
      } catch (error) {
        logger.error('ERC4626 fetcher failed:', error);
      }
    }

    // Update missing tokens list
    missingTokens = tokens.filter(t => !priceMap.has(t.address.toLowerCase()));

    // 10-11. Yearn Vault Price Per Share (both cached and live use same fetcher)
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