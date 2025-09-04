import { logger } from 'utils/logger'

interface CachedPrice {
  address: string
  price?: bigint
  data?: any // For storing additional data like TVL/totalSupply
  timestamp: number
  source: string
}

class DiscoveryPriceCache {
  private cache: Map<string, CachedPrice> = new Map()
  private readonly TTL = 5 * 60 * 1000 // 5 minutes

  /**
   * Store a price discovered during the discovery phase
   */
  set(
    chainId: number,
    address: string,
    price: bigint | undefined,
    source: string,
    data?: any,
  ): void {
    const key = `${chainId}-${address.toLowerCase()}`
    this.cache.set(key, {
      address: address.toLowerCase(),
      price,
      data,
      timestamp: Date.now(),
      source,
    })
  }

  /**
   * Retrieve a cached price if it exists and is not expired
   */
  get(chainId: number, address: string): CachedPrice | null {
    const key = `${chainId}-${address.toLowerCase()}`
    const cached = this.cache.get(key)

    if (!cached) {
      return null
    }

    // Check if expired
    if (Date.now() - cached.timestamp > this.TTL) {
      this.cache.delete(key)
      return null
    }

    return cached
  }

  /**
   * Clear all cached prices
   */
  clear(): void {
    const size = this.cache.size
    this.cache.clear()
    if (size > 0) {
      logger.debug(`Cleared ${size} cached discovery prices`)
    }
  }

  /**
   * Clear expired entries
   */
  cleanup(): void {
    const now = Date.now()
    const expired = Array.from(this.cache.entries()).filter(
      ([_, cached]) => now - cached.timestamp > this.TTL,
    )

    expired.forEach(([key]) => {
      this.cache.delete(key)
    })

    if (expired.length > 0) {
      logger.debug(`Removed ${expired.length} expired discovery prices`)
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; sources: Record<string, number> } {
    const sources: Record<string, number> = {}

    for (const cached of this.cache.values()) {
      sources[cached.source] = (sources[cached.source] || 0) + 1
    }

    return {
      size: this.cache.size,
      sources,
    }
  }
}

// Export singleton instance
export const discoveryPriceCache = new DiscoveryPriceCache()
