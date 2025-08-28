import { Price } from '../models';
import { logger } from './logger';

interface CachedPrice {
  price: Price;
  timestamp: number;
  ttl: number;
}

interface TokenType {
  isStablecoin: boolean;
  isMajor: boolean;
  isLP: boolean;
  isVault: boolean;
}

export class PriceCache {
  private cache: Map<string, CachedPrice> = new Map();
  
  // TTL configurations in milliseconds
  private readonly TTL_STABLECOIN = 5 * 60 * 1000; // 5 minutes
  private readonly TTL_MAJOR = 60 * 1000; // 1 minute
  private readonly TTL_LP_VAULT = 30 * 1000; // 30 seconds
  private readonly TTL_DEFAULT = 2 * 60 * 1000; // 2 minutes
  
  // Known stablecoins
  private readonly STABLECOINS = new Set([
    'usdc', 'usdt', 'dai', 'busd', 'tusd', 'usdp', 'gusd', 'frax', 'usdd', 'lusd', 'susd', 'mim', 'alchemix'
  ]);
  
  // Major tokens (high liquidity, frequently traded)
  private readonly MAJOR_TOKENS = new Set([
    'eth', 'weth', 'btc', 'wbtc', 'bnb', 'matic', 'avax', 'sol', 'dot', 'uni', 'link', 'aave', 'crv', 'mkr', 'snx', 'comp'
  ]);

  /**
   * Get cached price if it exists and is still valid
   */
  get(chainId: number, address: string): Price | null {
    const key = this.getCacheKey(chainId, address);
    const cached = this.cache.get(key);
    
    if (!cached) {
      return null;
    }
    
    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      // Cache expired
      this.cache.delete(key);
      return null;
    }
    
    return cached.price;
  }

  /**
   * Get multiple cached prices at once
   * Returns a map of address -> price for cached items
   */
  getMany(chainId: number, addresses: string[]): Map<string, Price> {
    const prices = new Map<string, Price>();
    
    for (const address of addresses) {
      const cached = this.get(chainId, address);
      if (cached) {
        prices.set(address.toLowerCase(), cached);
      }
    }
    
    return prices;
  }

  /**
   * Set price in cache with appropriate TTL based on token type
   */
  set(chainId: number, address: string, price: Price, symbol?: string): void {
    const key = this.getCacheKey(chainId, address);
    const tokenType = this.getTokenType(symbol || '', address);
    const ttl = this.getTTL(tokenType);
    
    this.cache.set(key, {
      price,
      timestamp: Date.now(),
      ttl
    });
  }

  /**
   * Set multiple prices at once
   */
  setMany(chainId: number, prices: Map<string, Price>, symbols?: Map<string, string>): void {
    for (const [address, price] of prices) {
      const symbol = symbols?.get(address.toLowerCase());
      this.set(chainId, address, price, symbol);
    }
  }

  /**
   * Clear expired entries from cache
   */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, cached] of this.cache) {
      if (now - cached.timestamp > cached.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      logger.debug(`Price cache: Removed ${removed} expired entries`);
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.debug(`Price cache: Cleared ${size} entries`);
  }

  /**
   * Get cache statistics
   */
  getStats(): { total: number; chains: Map<number, number> } {
    const chains = new Map<number, number>();
    
    for (const key of this.cache.keys()) {
      const [chainId] = key.split(':');
      const chain = parseInt(chainId);
      chains.set(chain, (chains.get(chain) || 0) + 1);
    }
    
    return {
      total: this.cache.size,
      chains
    };
  }

  /**
   * Get cache key for chain and address
   */
  private getCacheKey(chainId: number, address: string): string {
    return `${chainId}:${address.toLowerCase()}`;
  }

  /**
   * Determine token type based on symbol and address patterns
   */
  private getTokenType(symbol: string, address: string): TokenType {
    const lowerSymbol = symbol.toLowerCase();
    
    return {
      isStablecoin: this.STABLECOINS.has(lowerSymbol) || 
                    lowerSymbol.includes('usd') || 
                    lowerSymbol.includes('eur'),
      isMajor: this.MAJOR_TOKENS.has(lowerSymbol),
      isLP: lowerSymbol.includes('lp') || 
            lowerSymbol.includes('-') || 
            lowerSymbol.includes('uni-v'),
      isVault: lowerSymbol.startsWith('yv') || 
               lowerSymbol.includes('vault') || 
               lowerSymbol.includes('4626')
    };
  }

  /**
   * Get appropriate TTL based on token type
   */
  private getTTL(tokenType: TokenType): number {
    if (tokenType.isStablecoin) {
      return this.TTL_STABLECOIN;
    }
    if (tokenType.isMajor) {
      return this.TTL_MAJOR;
    }
    if (tokenType.isLP || tokenType.isVault) {
      return this.TTL_LP_VAULT;
    }
    return this.TTL_DEFAULT;
  }
}

// Singleton instance
export const priceCache = new PriceCache();

// Run cleanup every minute
setInterval(() => {
  priceCache.cleanup();
}, 60 * 1000);