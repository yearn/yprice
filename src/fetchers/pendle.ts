import axios from 'axios';
import { ERC20Token, Price } from '../models';
import { logger, discoveryPriceCache } from '../utils';

interface PendleMarket {
  address: string;
  chainId: number;
  pt: {
    address: string;
    price?: {
      usd: number;
    };
  };
  yt: {
    address: string;
    price?: {
      usd: number;
    };
  };
  sy: {
    address: string;
    price?: {
      usd: number;
    };
  };
  price?: {
    usd: number;
  };
}

interface PendleAsset {
  address: string;
  chainId: number;
  price?: {
    usd: number;
  };
}

interface PendleMarketsResponse {
  results: PendleMarket[];
}

interface PendleAssetsResponse {
  results: PendleAsset[];
}

// Pendle API endpoints
const PENDLE_MARKETS_URLS: Record<number, string> = {
  1: 'https://api-v2.pendle.finance/core/v1/1/markets?limit=100',
  10: 'https://api-v2.pendle.finance/core/v1/10/markets?limit=100',
  42161: 'https://api-v2.pendle.finance/core/v1/42161/markets?limit=100',
  8453: 'https://api-v2.pendle.finance/core/v1/8453/markets?limit=100',
  56: 'https://api-v2.pendle.finance/core/v1/56/markets?limit=100',
};

const PENDLE_ASSETS_URLS: Record<number, string> = {
  1: 'https://api-v2.pendle.finance/core/v1/1/assets/all',
  10: 'https://api-v2.pendle.finance/core/v1/10/assets/all',
  42161: 'https://api-v2.pendle.finance/core/v1/42161/assets/all',
  8453: 'https://api-v2.pendle.finance/core/v1/8453/assets/all',
  56: 'https://api-v2.pendle.finance/core/v1/56/assets/all',
};

export class PendleFetcher {
  async fetchPrices(
    chainId: number,
    tokens: ERC20Token[]
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>();
    
    // First check cache for prices
    const { cached, uncached } = tokens.reduce(
      (acc, token) => {
        const cachedPrice = discoveryPriceCache.get(chainId, token.address);
        if (cachedPrice && cachedPrice.price) {
          priceMap.set(token.address.toLowerCase(), {
            address: token.address.toLowerCase(),
            price: cachedPrice.price,
            source: cachedPrice.source,
          });
          return { ...acc, cached: [...acc.cached, token] };
        }
        return { ...acc, uncached: [...acc.uncached, token] };
      },
      { cached: [] as ERC20Token[], uncached: [] as ERC20Token[] }
    );
    
    if (cached.length > 0) {
      logger.debug(`Pendle: Using ${cached.length} cached prices for chain ${chainId}`);
    }
    
    // If all prices are cached, return early
    if (uncached.length === 0) {
      return priceMap;
    }
    
    const marketsUrl = PENDLE_MARKETS_URLS[chainId];
    const assetsUrl = PENDLE_ASSETS_URLS[chainId];
    
    if (!marketsUrl && !assetsUrl) {
      return priceMap;
    }

    const tokenAddresses = new Set(uncached.map(t => t.address.toLowerCase()));

    try {
      // Fetch prices from markets endpoint
      if (marketsUrl) {
        await this.fetchMarketPrices(marketsUrl, tokenAddresses, priceMap);
      }

      // Fetch prices from assets endpoint
      if (assetsUrl) {
        await this.fetchAssetPrices(assetsUrl, tokenAddresses, priceMap);
      }

      logger.debug(`Pendle: Total ${priceMap.size} prices for chain ${chainId} (${cached.length} cached, ${priceMap.size - cached.length} fetched)`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`Pendle fetch failed for chain ${chainId}: ${errorMsg}`);
    }

    return priceMap;
  }

  private async fetchMarketPrices(
    url: string,
    tokenAddresses: Set<string>,
    priceMap: Map<string, Price>
  ): Promise<void> {
    const baseUrl = url.split('?')[0];
    const allMarkets: PendleMarket[] = [];
    const limit = 100;
    let skip = 0;

    try {
      // Fetch all pages
      while (true) {
        const paginatedUrl = `${baseUrl}?order_by=name%3A1&skip=${skip}&limit=${limit}`;
        const response = await axios.get<PendleMarketsResponse>(paginatedUrl, {
          timeout: 30000,
          headers: { 
            'User-Agent': 'yearn-pricing-service',
            'Accept': 'application/json'
          },
        });

        if (!response.data?.results || response.data.results.length === 0) {
          break;
        }

        allMarkets.push(...response.data.results);

        if (response.data.results.length < limit) {
          break;
        }

        skip += limit;
      }

      for (const market of allMarkets) {
        // Market LP token price
        const marketAddress = market.address.toLowerCase();
        if (tokenAddresses.has(marketAddress) && market.price?.usd) {
          const price = BigInt(Math.floor(market.price.usd * 1e6));
          if (price > BigInt(0)) {
            priceMap.set(marketAddress, {
              address: marketAddress,
              price,
              source: 'pendle-market',
            });
          }
        }

        // PT (Principal Token) price
        if (market.pt) {
          const ptAddress = market.pt.address.toLowerCase();
          if (tokenAddresses.has(ptAddress) && market.pt.price?.usd) {
            const price = BigInt(Math.floor(market.pt.price.usd * 1e6));
            if (price > BigInt(0)) {
              priceMap.set(ptAddress, {
                address: ptAddress,
                price,
                source: 'pendle-pt',
              });
            }
          }
        }

        // YT (Yield Token) price
        if (market.yt) {
          const ytAddress = market.yt.address.toLowerCase();
          if (tokenAddresses.has(ytAddress) && market.yt.price?.usd) {
            const price = BigInt(Math.floor(market.yt.price.usd * 1e6));
            if (price > BigInt(0)) {
              priceMap.set(ytAddress, {
                address: ytAddress,
                price,
                source: 'pendle-yt',
              });
            }
          }
        }

        // SY (Standardized Yield) price
        if (market.sy) {
          const syAddress = market.sy.address.toLowerCase();
          if (tokenAddresses.has(syAddress) && market.sy.price?.usd) {
            const price = BigInt(Math.floor(market.sy.price.usd * 1e6));
            if (price > BigInt(0)) {
              priceMap.set(syAddress, {
                address: syAddress,
                price,
                source: 'pendle-sy',
              });
            }
          }
        }
      }
    } catch (error) {
      logger.debug(`Failed to fetch Pendle market prices: ${error}`);
    }
  }

  private async fetchAssetPrices(
    url: string,
    tokenAddresses: Set<string>,
    priceMap: Map<string, Price>
  ): Promise<void> {
    try {
      const response = await axios.get<PendleAssetsResponse>(url, {
        timeout: 30000,
        headers: { 
          'User-Agent': 'yearn-pricing-service',
          'Accept': 'application/json'
        },
      });

      if (!response.data?.results) {
        return;
      }

      for (const asset of response.data.results) {
        const assetAddress = asset.address.toLowerCase();
        if (tokenAddresses.has(assetAddress) && asset.price?.usd && !priceMap.has(assetAddress)) {
          const price = BigInt(Math.floor(asset.price.usd * 1e6));
          if (price > BigInt(0)) {
            priceMap.set(assetAddress, {
              address: assetAddress,
              price,
              source: 'pendle-asset',
            });
          }
        }
      }
    } catch (error) {
      logger.debug(`Failed to fetch Pendle asset prices: ${error}`);
    }
  }
}