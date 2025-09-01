import axios from 'axios';
import https from 'https';
import { TokenInfo } from './types';
import { logger, discoveryPriceCache } from '../utils';
import { zeroAddress } from 'viem';

interface PendleAsset {
  id: string;
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  expiry?: string;
  price?: {
    usd: number;
  };
  pt?: {
    address: string;
    symbol: string;
    price?: {
      usd: number;
    };
  };
  yt?: {
    address: string;
    symbol: string;
    price?: {
      usd: number;
    };
  };
  sy?: {
    address: string;
    symbol: string;
    price?: {
      usd: number;
    };
  };
  underlyingAsset?: {
    address: string;
    symbol: string;
  };
}

interface PendleResponse {
  results: PendleAsset[];
}

interface PendleMarket {
  address: string;
  chainId: number;
  price?: {
    usd: number;
  };
  pt: {
    address: string;
    symbol: string;
    price?: {
      usd: number;
    };
  };
  yt: {
    address: string;
    symbol: string;
    price?: {
      usd: number;
    };
  };
  sy: {
    address: string;
    symbol: string;
    price?: {
      usd: number;
    };
  };
}

interface PendleMarketsResponse {
  results: PendleMarket[];
}

// Pendle API endpoints per chain
const PENDLE_API_URLS: Record<number, string> = {
  1: 'https://api-v2.pendle.finance/core/v1/1/assets/all',
  42161: 'https://api-v2.pendle.finance/core/v1/42161/assets/all',
  8453: 'https://api-v2.pendle.finance/core/v1/8453/assets/all',
  10: 'https://api-v2.pendle.finance/core/v1/10/assets/all',
  56: 'https://api-v2.pendle.finance/core/v1/56/assets/all',
};

const PENDLE_MARKETS_URLS: Record<number, string> = {
  1: 'https://api-v2.pendle.finance/core/v1/1/markets?order_by=name%3A1&skip=0&limit=100',
  42161: 'https://api-v2.pendle.finance/core/v1/42161/markets?order_by=name%3A1&skip=0&limit=100',
  8453: 'https://api-v2.pendle.finance/core/v1/8453/markets?order_by=name%3A1&skip=0&limit=100',
  10: 'https://api-v2.pendle.finance/core/v1/10/markets?order_by=name%3A1&skip=0&limit=100',
  56: 'https://api-v2.pendle.finance/core/v1/56/markets?order_by=name%3A1&skip=0&limit=100',
};

export class PendleDiscovery {
  private chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    // Discover from assets endpoint
    const assetsUrl = PENDLE_API_URLS[this.chainId];
    if (assetsUrl) {
      const assetsTokens = await this.discoverFromAssets(assetsUrl);
      tokens.push(...assetsTokens);
    }
    
    // Discover from markets endpoint
    const marketsUrl = PENDLE_MARKETS_URLS[this.chainId];
    if (marketsUrl) {
      const marketsTokens = await this.discoverFromMarkets(marketsUrl);
      tokens.push(...marketsTokens);
    }

    if (tokens.length === 0) {
      return tokens; // No Pendle on this chain
    }

    logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} Pendle tokens total`);
    return this.deduplicateTokens(tokens);
  }

  private async discoverFromAssets(apiUrl: string): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];

    try {
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false // Temporarily disable SSL verification
      });
      
      const response = await axios.get<PendleResponse>(apiUrl, {
        timeout: 30000,
        headers: { 
          'User-Agent': 'yearn-pricing-service',
          'Accept': 'application/json'
        },
        httpsAgent: httpsAgent
      });

      if (response.data?.results) {
        for (const asset of response.data.results) {
          // Add main asset
          tokens.push({
            address: asset.address.toLowerCase(),
            chainId: this.chainId,
            name: asset.name,
            symbol: asset.symbol,
            decimals: asset.decimals,
            source: 'pendle-asset',
          });

          // Cache price if available
          if (asset.price?.usd) {
            const price = BigInt(Math.floor(asset.price.usd * 1e6));
            discoveryPriceCache.set(this.chainId, asset.address, price, 'pendle-asset');
          }

          // Add PT (Principal Token) if exists
          if (asset.pt?.address && asset.pt.address !== zeroAddress) {
            tokens.push({
              address: asset.pt.address.toLowerCase(),
              chainId: this.chainId,
              symbol: asset.pt.symbol,
              source: 'pendle-pt',
            });
            
            // Cache PT price if available
            if (asset.pt.price?.usd) {
              const price = BigInt(Math.floor(asset.pt.price.usd * 1e6));
              discoveryPriceCache.set(this.chainId, asset.pt.address, price, 'pendle-pt');
            }
          }

          // Add YT (Yield Token) if exists
          if (asset.yt?.address && asset.yt.address !== zeroAddress) {
            tokens.push({
              address: asset.yt.address.toLowerCase(),
              chainId: this.chainId,
              symbol: asset.yt.symbol,
              source: 'pendle-yt',
            });
            
            // Cache YT price if available
            if (asset.yt.price?.usd) {
              const price = BigInt(Math.floor(asset.yt.price.usd * 1e6));
              discoveryPriceCache.set(this.chainId, asset.yt.address, price, 'pendle-yt');
            }
          }

          // Add SY (Standardized Yield) token if exists
          if (asset.sy?.address && asset.sy.address !== zeroAddress) {
            tokens.push({
              address: asset.sy.address.toLowerCase(),
              chainId: this.chainId,
              symbol: asset.sy.symbol,
              source: 'pendle-sy',
            });
            
            // Cache SY price if available
            if (asset.sy.price?.usd) {
              const price = BigInt(Math.floor(asset.sy.price.usd * 1e6));
              discoveryPriceCache.set(this.chainId, asset.sy.address, price, 'pendle-sy');
            }
          }

          // Add underlying asset if exists
          if (asset.underlyingAsset?.address && 
              asset.underlyingAsset.address !== zeroAddress) {
            tokens.push({
              address: asset.underlyingAsset.address.toLowerCase(),
              chainId: this.chainId,
              symbol: asset.underlyingAsset.symbol,
              source: 'pendle-underlying',
            });
          }
        }
      }

      logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} Pendle assets`);
    } catch (error: any) {
      logger.warn(`Pendle assets discovery failed for chain ${this.chainId}:`, error.message);
    }

    return tokens;
  }

  private async discoverFromMarkets(apiUrl: string): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];

    try {
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false // Temporarily disable SSL verification
      });
      
      const response = await axios.get<PendleMarketsResponse>(apiUrl, {
        timeout: 30000,
        headers: { 
          'User-Agent': 'yearn-pricing-service',
          'Accept': 'application/json'
        },
        httpsAgent: httpsAgent
      });

      if (response.data?.results) {
        for (const market of response.data.results) {
          // Add market token itself
          if (market.address) {
            tokens.push({
              address: market.address.toLowerCase(),
              chainId: this.chainId,
              source: 'pendle-market',
            });
            
            // Cache market price if available
            if (market.price?.usd) {
              const price = BigInt(Math.floor(market.price.usd * 1e6));
              discoveryPriceCache.set(this.chainId, market.address, price, 'pendle-market');
            }
          }

          // Add PT (Principal Token)
          if (market.pt?.address && market.pt.address !== zeroAddress) {
            tokens.push({
              address: market.pt.address.toLowerCase(),
              chainId: this.chainId,
              symbol: market.pt.symbol,
              source: 'pendle-pt',
            });
            
            // Cache PT price if available
            if (market.pt.price?.usd) {
              const price = BigInt(Math.floor(market.pt.price.usd * 1e6));
              discoveryPriceCache.set(this.chainId, market.pt.address, price, 'pendle-pt');
            }
          }

          // Add YT (Yield Token)
          if (market.yt?.address && market.yt.address !== zeroAddress) {
            tokens.push({
              address: market.yt.address.toLowerCase(),
              chainId: this.chainId,
              symbol: market.yt.symbol,
              source: 'pendle-yt',
            });
            
            // Cache YT price if available
            if (market.yt.price?.usd) {
              const price = BigInt(Math.floor(market.yt.price.usd * 1e6));
              discoveryPriceCache.set(this.chainId, market.yt.address, price, 'pendle-yt');
            }
          }

          // Add SY (Standardized Yield) token
          if (market.sy?.address && market.sy.address !== zeroAddress) {
            tokens.push({
              address: market.sy.address.toLowerCase(),
              chainId: this.chainId,
              symbol: market.sy.symbol,
              source: 'pendle-sy',
            });
            
            // Cache SY price if available
            if (market.sy.price?.usd) {
              const price = BigInt(Math.floor(market.sy.price.usd * 1e6));
              discoveryPriceCache.set(this.chainId, market.sy.address, price, 'pendle-sy');
            }
          }
        }
      }

      logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} Pendle market tokens`);
    } catch (error: any) {
      logger.warn(`Pendle markets discovery failed for chain ${this.chainId}:`, error.message);
    }

    return tokens;
  }

  private deduplicateTokens(tokens: TokenInfo[]): TokenInfo[] {
    const seen = new Set<string>();
    const unique: TokenInfo[] = [];

    for (const token of tokens) {
      const key = `${token.chainId}-${token.address.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(token);
      }
    }

    return unique;
  }
}