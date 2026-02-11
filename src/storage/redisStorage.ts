import { Redis } from '@upstash/redis'
import { Price, SUPPORTED_CHAINS } from 'models/index'
import { logger } from 'utils/index'

interface PriceCacheEntry extends Price {
  timestamp: number
}

interface ChainPriceData {
  [address: string]: PriceCacheEntry
}

export class RedisStorage {
  private redis: Redis
  private cacheTTL: number
  private keyPrefix: string = 'yprice'

  private consecutiveFailures = 0
  private circuitOpen = false
  private static readonly FAILURE_THRESHOLD = 1
  private onCircuitOpen?: () => void

  private handleRedisError(operation: string, error: unknown): void {
    this.consecutiveFailures++
    if (this.consecutiveFailures >= RedisStorage.FAILURE_THRESHOLD && !this.circuitOpen) {
      this.circuitOpen = true
      logger.error(
        `Redis circuit breaker open after ${this.consecutiveFailures} failures — skipping subsequent operations`,
      )
      this.onCircuitOpen?.()
    }
    if (!this.circuitOpen) {
      logger.error(`Redis ${operation} failed:`, error)
    }
  }

  private handleRedisSuccess(): void {
    if (this.circuitOpen) {
      logger.info('Redis connection restored')
    }
    this.consecutiveFailures = 0
    this.circuitOpen = false
  }

  constructor(cacheTTL: number = 60, onCircuitOpen?: () => void) {
    this.cacheTTL = cacheTTL
    this.onCircuitOpen = onCircuitOpen

    const redisUrl = process.env.UPSTASH_REDIS_REST_URL
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN

    if (!redisUrl || !redisToken) {
      throw new Error(
        'Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN environment variables',
      )
    }

    this.redis = new Redis({
      url: redisUrl,
      token: redisToken,
    })

    logger.info('Redis storage initialized')
  }

  private getChainKey(chainId: number): string {
    return `${this.keyPrefix}:chain:${chainId}`
  }

  public async storePrice(chainId: number, price: Price): Promise<void> {
    await this.storePrices(chainId, [price])
  }

  public async storePrices(chainId: number, prices: Price[]): Promise<void> {
    if (this.circuitOpen) return

    try {
      const timestamp = Date.now()
      const key = this.getChainKey(chainId)

      const chainData: ChainPriceData = (await this.getChainData(chainId)) ?? {}

      for (const price of prices) {
        chainData[price.address.toLowerCase()] = {
          ...price,
          address: price.address.toLowerCase(),
          timestamp,
        }
      }

      const dataStr = JSON.stringify(chainData, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      )

      if (this.cacheTTL > 0) {
        await this.redis.setex(key, this.cacheTTL, dataStr)
      } else {
        await this.redis.set(key, dataStr)
      }

      this.handleRedisSuccess()
      logger.debug(`Stored ${prices.length} prices for chain ${chainId} in Redis`)
    } catch (error) {
      this.handleRedisError(`storePrices(chain=${chainId})`, error)
    }
  }

  /**
   * Parse raw Redis data into typed ChainPriceData, handling both
   * string and pre-parsed object responses and restoring BigInt prices.
   */
  private parseChainData(raw: unknown): ChainPriceData | null {
    if (!raw) return null

    const chainData: ChainPriceData =
      typeof raw === 'string' ? (JSON.parse(raw) as ChainPriceData) : (raw as ChainPriceData)

    for (const entry of Object.values(chainData)) {
      if (typeof entry.price === 'string') {
        entry.price = BigInt(entry.price)
      }
    }

    return chainData
  }

  private async getChainData(chainId: number): Promise<ChainPriceData | null> {
    if (this.circuitOpen) return null

    let data: unknown
    try {
      data = await this.redis.get(this.getChainKey(chainId))
      this.handleRedisSuccess()
    } catch (error) {
      this.handleRedisError(`getChainData(chain=${chainId})`, error)
      return null
    }

    try {
      return this.parseChainData(data)
    } catch (error) {
      logger.error(`Failed to parse chain data for chain ${chainId}:`, error)
      return null
    }
  }

  public async getPrice(chainId: number, address: string): Promise<Price | undefined> {
    const chainData = await this.getChainData(chainId)
    if (!chainData) return undefined

    const entry = chainData[address.toLowerCase()]
    if (!entry) return undefined

    const { timestamp: _timestamp, ...price } = entry
    return price
  }

  public async listPrices(
    chainId: number,
  ): Promise<{ asMap: Map<string, Price>; asSlice: Price[] }> {
    const chainData = await this.getChainData(chainId)

    const asMap = new Map<string, Price>()
    const asSlice: Price[] = []

    if (!chainData) {
      return { asMap, asSlice }
    }

    for (const entry of Object.values(chainData)) {
      const { timestamp: _timestamp, ...price } = entry
      asMap.set(price.address, price)
      asSlice.push(price)
    }

    return { asMap, asSlice }
  }

  public async getAllPrices(): Promise<Map<number, Map<string, Price>>> {
    const allPrices = new Map<number, Map<string, Price>>()

    if (this.circuitOpen) return allPrices

    const chainIds = Object.values(SUPPORTED_CHAINS).map((c) => c.id)

    let results: unknown[]
    try {
      const pipeline = this.redis.pipeline()
      for (const chainId of chainIds) {
        pipeline.get(this.getChainKey(chainId))
      }
      results = await pipeline.exec()
      this.handleRedisSuccess()
    } catch (error) {
      this.handleRedisError('getAllPrices', error)
      return allPrices
    }

    for (let i = 0; i < results.length; i++) {
      const chainId = chainIds[i]
      if (!chainId) continue

      // Upstash pipeline results may be wrapped in { result: ... }
      const result = results[i]
      const rawData =
        result != null && typeof result === 'object' && 'result' in result ? result.result : result

      try {
        const chainData = this.parseChainData(rawData)
        if (!chainData) continue

        const chainMap = new Map<string, Price>()
        for (const entry of Object.values(chainData)) {
          if (!entry || typeof entry !== 'object') continue
          const { timestamp: _timestamp, ...price } = entry
          chainMap.set(price.address, price)
        }

        if (chainMap.size > 0) {
          allPrices.set(chainId, chainMap)
        }
      } catch (error) {
        logger.error(`Failed to parse chain data for chain ${chainId}:`, error)
      }
    }

    logger.info(`Redis getAllPrices: ${allPrices.size} chains loaded`)
    return allPrices
  }

  public async clearCache(chainId?: number): Promise<void> {
    if (this.circuitOpen) return

    try {
      if (chainId) {
        await this.redis.del(this.getChainKey(chainId))
        logger.info(`Cleared prices for chain ${chainId}`)
      } else {
        // Clear all chains
        const chainIds = Object.values(SUPPORTED_CHAINS).map((c) => c.id)
        const pipeline = this.redis.pipeline()

        for (const id of chainIds) {
          pipeline.del(this.getChainKey(id))
        }

        await pipeline.exec()
        logger.info(`Cleared prices for all chains`)
      }
      this.handleRedisSuccess()
    } catch (error) {
      this.handleRedisError('clearCache', error)
    }
  }

  public async getStats(chainId?: number): Promise<any> {
    if (chainId) {
      const chainData = await this.getChainData(chainId)
      return {
        priceCount: chainData ? Object.keys(chainData).length : 0,
        chainId,
      }
    }

    const stats: Record<number, any> = {}
    for (const chain of Object.values(SUPPORTED_CHAINS)) {
      stats[chain.id] = await this.getStats(chain.id)
    }
    return stats
  }

  /**
   * Load backup data from file storage into Redis
   * This is useful for migrating from file to Redis storage
   */
  public async loadFromFileBackup(backupDir: string): Promise<void> {
    const fs = await import('node:fs')
    const path = await import('node:path')

    try {
      if (!fs.existsSync(backupDir)) {
        logger.warn(`Backup directory ${backupDir} does not exist`)
        return
      }

      let totalLoaded = 0

      for (const chain of Object.values(SUPPORTED_CHAINS)) {
        const backupFile = path.join(backupDir, `chain_${chain.id}.json`)
        if (!fs.existsSync(backupFile)) continue

        const fileData = fs.readFileSync(backupFile, 'utf8')
        const rawPrices = JSON.parse(fileData)

        // Handle both old format (Record<string, PriceCacheEntry>) and new format
        const chainData: ChainPriceData = {}

        // Check if it's already in the new format (object with address keys)
        const entries = Object.entries(rawPrices)
        for (const [key, value] of entries) {
          // Determine if this is an address or some other key
          const isAddress = key.startsWith('0x') && key.length === 42

          if (isAddress && value && typeof value === 'object') {
            const entry = value as any
            if (typeof entry.price === 'string') {
              entry.price = BigInt(entry.price)
            }
            chainData[key.toLowerCase()] = {
              ...entry,
              address: key.toLowerCase(),
              timestamp: entry.timestamp || Date.now(),
            }
          }
        }

        // Store entire chain data at once
        if (this.circuitOpen) break

        const key = this.getChainKey(chain.id)
        const dataStr = JSON.stringify(chainData, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        )

        try {
          if (this.cacheTTL > 0) {
            await this.redis.setex(key, this.cacheTTL, dataStr)
          } else {
            await this.redis.set(key, dataStr)
          }
          this.handleRedisSuccess()
        } catch (redisError) {
          this.handleRedisError(`loadFromFileBackup(chain=${chain.id})`, redisError)
          continue
        }

        const priceCount = Object.keys(chainData).length
        if (priceCount > 0) {
          logger.info(`Loaded ${priceCount} prices for chain ${chain.id} from backup`)
          totalLoaded += priceCount
        }
      }

      if (totalLoaded > 0) {
        logger.info(`📊 Total prices loaded from backup into Redis: ${totalLoaded}`)
      }
    } catch (error) {
      logger.error(`Failed to load backup data into Redis:`, error)
    }
  }
}
