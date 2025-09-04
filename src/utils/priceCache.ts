import { filter, forEach, groupBy, includes, mapValues, reduce } from 'lodash'
import { Price } from 'models/index'
import { logger } from 'utils/logger'

interface CachedPrice {
  price: Price
  timestamp: number
  ttl: number
}

interface TokenType {
  isStablecoin: boolean
  isMajor: boolean
  isLP: boolean
  isVault: boolean
}

export class PriceCache {
  private cache: Map<string, CachedPrice> = new Map()

  private readonly TTL_STABLECOIN = 5 * 60 * 1000
  private readonly TTL_MAJOR = 60 * 1000
  private readonly TTL_LP_VAULT = 30 * 1000
  private readonly TTL_DEFAULT = 2 * 60 * 1000

  private readonly STABLECOINS = new Set([
    'usdc',
    'usdt',
    'dai',
    'busd',
    'tusd',
    'usdp',
    'gusd',
    'frax',
    'usdd',
    'lusd',
    'susd',
    'mim',
    'alchemix',
  ])

  private readonly MAJOR_TOKENS = new Set([
    'eth',
    'weth',
    'btc',
    'wbtc',
    'bnb',
    'matic',
    'avax',
    'sol',
    'dot',
    'uni',
    'link',
    'aave',
    'crv',
    'mkr',
    'snx',
    'comp',
  ])

  get(chainId: number, address: string): Price | null {
    const key = this.getCacheKey(chainId, address)
    const cached = this.cache.get(key)

    if (!cached) return null

    const now = Date.now()
    if (now - cached.timestamp > cached.ttl) {
      this.cache.delete(key)
      return null
    }

    return cached.price
  }

  getMany(chainId: number, addresses: string[]): Map<string, Price> {
    return reduce(
      addresses,
      (acc, address) => {
        const cached = this.get(chainId, address)
        if (cached) acc.set(address.toLowerCase(), cached)
        return acc
      },
      new Map<string, Price>(),
    )
  }

  set(chainId: number, address: string, price: Price, symbol?: string): void {
    const key = this.getCacheKey(chainId, address)
    const tokenType = this.getTokenType(symbol || '', address)
    const ttl = this.getTTL(tokenType)

    this.cache.set(key, {
      price,
      timestamp: Date.now(),
      ttl,
    })
  }

  setMany(chainId: number, prices: Map<string, Price>, symbols?: Map<string, string>): void {
    forEach(Array.from(prices.entries()), ([address, price]) => {
      const symbol = symbols?.get(address.toLowerCase())
      this.set(chainId, address, price, symbol)
    })
  }

  cleanup(): void {
    const now = Date.now()
    const expired = filter(
      Array.from(this.cache.entries()),
      ([_, cached]) => now - cached.timestamp > cached.ttl,
    )

    forEach(expired, ([key]) => this.cache.delete(key))

    if (expired.length > 0) {
      logger.debug(`Price cache: Removed ${expired.length} expired entries`)
    }
  }

  clear(): void {
    const size = this.cache.size
    this.cache.clear()
    logger.debug(`Price cache: Cleared ${size} entries`)
  }

  getStats(): { total: number; chains: Map<number, number> } {
    const entries = Array.from(this.cache.keys())
    const grouped = groupBy(entries, (key) => key.split(':')[0] || '0')

    const chains = new Map<number, number>(
      Object.entries(mapValues(grouped, (arr) => arr.length)).map(([chainId, count]) => [
        parseInt(chainId, 10),
        count,
      ]),
    )

    return {
      total: this.cache.size,
      chains,
    }
  }

  private getCacheKey(chainId: number, address: string): string {
    return `${chainId}:${address.toLowerCase()}`
  }

  private getTokenType(symbol: string, _address: string): TokenType {
    const lowerSymbol = symbol.toLowerCase()

    return {
      isStablecoin:
        this.STABLECOINS.has(lowerSymbol) ||
        includes(lowerSymbol, 'usd') ||
        includes(lowerSymbol, 'eur'),
      isMajor: this.MAJOR_TOKENS.has(lowerSymbol),
      isLP:
        includes(lowerSymbol, 'lp') || includes(lowerSymbol, '-') || includes(lowerSymbol, 'uni-v'),
      isVault:
        lowerSymbol.startsWith('yv') ||
        includes(lowerSymbol, 'vault') ||
        includes(lowerSymbol, '4626'),
    }
  }

  private getTTL(tokenType: TokenType): number {
    if (tokenType.isStablecoin) return this.TTL_STABLECOIN
    if (tokenType.isMajor) return this.TTL_MAJOR
    if (tokenType.isLP || tokenType.isVault) return this.TTL_LP_VAULT
    return this.TTL_DEFAULT
  }
}

export const priceCache = new PriceCache()

setInterval(() => priceCache.cleanup(), 60 * 1000)
