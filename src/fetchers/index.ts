export * from './defillama';
export * from './coingecko';

import { DefilllamaFetcher } from './defillama';
import { CoingeckoFetcher } from './coingecko';
import { ERC20Token, Price } from '../models';
import { logger } from '../utils';

export class PriceFetcherOrchestrator {
  private defillama: DefilllamaFetcher;
  private coingecko: CoingeckoFetcher;

  constructor() {
    this.defillama = new DefilllamaFetcher();
    this.coingecko = new CoingeckoFetcher();
  }

  async fetchPrices(
    chainId: number, 
    tokens: ERC20Token[]
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>();

    logger.info(`Fetching prices for ${tokens.length} tokens on chain ${chainId}`);

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

    const missingTokens = tokens.filter(
      token => !priceMap.has(token.address.toLowerCase())
    );

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

    logger.info(`Total prices fetched: ${priceMap.size}/${tokens.length}`);
    
    return priceMap;
  }
}

export default new PriceFetcherOrchestrator();