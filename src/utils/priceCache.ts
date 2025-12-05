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
    const result = new Map<string, Price>()
    for (const address of addresses) {
      const cached = this.get(chainId, address)
      if (cached) result.set(address.toLowerCase(), cached)
    }
    return result
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
    for (const [address, price] of prices.entries()) {
      const symbol = symbols?.get(address.toLowerCase())
      this.set(chainId, address, price, symbol)
    }
  }

  cleanup(): void {
    const now = Date.now()
    let expiredCount = 0
    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > cached.ttl) {
        this.cache.delete(key)
        expiredCount++
      }
    }
    if (expiredCount > 0) {
      logger.debug(`Price cache: Removed ${expiredCount} expired entries`)
    }
  }

  clear(): void {
    const size = this.cache.size
    this.cache.clear()
    logger.debug(`Price cache: Cleared ${size} entries`)
  }

  getStats(): { total: number; chains: Map<number, number> } {
    const chainCounts = new Map<number, number>()
    for (const key of this.cache.keys()) {
      const chainId = parseInt(key.split(':')[0] || '0', 10)
      chainCounts.set(chainId, (chainCounts.get(chainId) || 0) + 1)
    }
    return {
      total: this.cache.size,
      chains: chainCounts,
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
        lowerSymbol.includes('usd') ||
        lowerSymbol.includes('eur'),
      isMajor: this.MAJOR_TOKENS.has(lowerSymbol),
      isLP:
        lowerSymbol.includes('lp') || lowerSymbol.includes('-') || lowerSymbol.includes('uni-v'),
      isVault:
        lowerSymbol.startsWith('yv') ||
        lowerSymbol.includes('vault') ||
        lowerSymbol.includes('4626'),
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
