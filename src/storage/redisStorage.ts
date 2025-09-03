import { Redis } from '@upstash/redis';
import { Price, SUPPORTED_CHAINS } from '../models';
import { logger } from '../utils';

interface PriceCacheEntry extends Price {
  timestamp: number;
}

interface ChainPriceData {
  [address: string]: PriceCacheEntry;
}

export class RedisStorage {
  private redis: Redis;
  private cacheTTL: number;
  private keyPrefix: string = 'yprice';

  constructor(cacheTTL: number = 60) {
    this.cacheTTL = cacheTTL;
    
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!redisUrl || !redisToken) {
      throw new Error('Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN environment variables');
    }
    
    this.redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });
    
    logger.info('Redis storage initialized');
  }

  private getChainKey(chainId: number): string {
    return `${this.keyPrefix}:chain:${chainId}`;
  }

  public async storePrice(chainId: number, price: Price): Promise<void> {
    await this.storePrices(chainId, [price]);
  }

  public async storePrices(chainId: number, prices: Price[]): Promise<void> {
    const timestamp = Date.now();
    const key = this.getChainKey(chainId);
    
    // Get existing chain data to merge with new prices
    const existingData = await this.getChainData(chainId);
    const chainData: ChainPriceData = existingData || {};
    
    // Update chain data with new prices
    for (const price of prices) {
      chainData[price.address.toLowerCase()] = {
        ...price,
        address: price.address.toLowerCase(),
        timestamp
      };
    }
    
    // Store entire chain data
    const dataStr = JSON.stringify(chainData, (_, v) => 
      typeof v === 'bigint' ? v.toString() : v
    );
    
    if (this.cacheTTL > 0) {
      await this.redis.setex(key, this.cacheTTL, dataStr);
    } else {
      await this.redis.set(key, dataStr);
    }
    
    logger.debug(`Stored ${prices.length} prices for chain ${chainId} in Redis`);
  }
  
  private async getChainData(chainId: number): Promise<ChainPriceData | null> {
    const key = this.getChainKey(chainId);
    const data = await this.redis.get(key);
    
    if (!data) return null;
    
    try {
      // Handle both string and object responses from Redis
      let chainData: ChainPriceData;
      if (typeof data === 'string') {
        chainData = JSON.parse(data) as ChainPriceData;
      } else {
        // If data is already an object, use it directly
        chainData = data as ChainPriceData;
      }
      
      // Convert string prices back to bigint
      for (const entry of Object.values(chainData)) {
        if (typeof entry.price === 'string') {
          entry.price = BigInt(entry.price);
        }
      }
      return chainData;
    } catch (error) {
      logger.error(`Failed to parse chain data for chain ${chainId}:`, error);
      return null;
    }
  }

  public async getPrice(chainId: number, address: string): Promise<Price | undefined> {
    const chainData = await this.getChainData(chainId);
    if (!chainData) return undefined;
    
    const entry = chainData[address.toLowerCase()];
    if (!entry) return undefined;
    
    const { timestamp, ...price } = entry;
    return price;
  }

  public async listPrices(chainId: number): Promise<{ asMap: Map<string, Price>, asSlice: Price[] }> {
    const chainData = await this.getChainData(chainId);
    
    const asMap = new Map<string, Price>();
    const asSlice: Price[] = [];
    
    if (!chainData) {
      return { asMap, asSlice };
    }
    
    for (const [, entry] of Object.entries(chainData)) {
      const { timestamp, ...price } = entry;
      asMap.set(price.address, price);
      asSlice.push(price);
    }
    
    return { asMap, asSlice };
  }

  public async getAllPrices(): Promise<Map<number, Map<string, Price>>> {
    const allPrices = new Map<number, Map<string, Price>>();
    
    // Get all chain keys at once
    const chainIds = Object.values(SUPPORTED_CHAINS).map(c => c.id);
    logger.info(`[RedisStorage] Fetching prices for chains: ${chainIds.join(', ')}`);
    
    const pipeline = this.redis.pipeline();
    
    for (const chainId of chainIds) {
      const key = this.getChainKey(chainId);
      logger.debug(`[RedisStorage] Adding key to pipeline: ${key}`);
      pipeline.get(key);
    }
    
    const results = await pipeline.exec();
    logger.info(`[RedisStorage] Pipeline returned ${results.length} results`);
    
    for (let i = 0; i < results.length; i++) {
      const chainId = chainIds[i];
      if (!chainId) continue;
      const result = results[i];
      
      logger.debug(`[RedisStorage] Result for chain ${chainId}:`, JSON.stringify(result).substring(0, 200));
      
      // Handle different response formats from Redis pipeline
      let rawData = null;
      if (result !== null && result !== undefined) {
        // Check if result is wrapped in { result: ... } format
        if (typeof result === 'object' && 'result' in result) {
          rawData = result.result;
        } else {
          // Direct result from pipeline
          rawData = result;
        }
      }
      
      if (rawData) {
        try {
          let chainData: ChainPriceData;
          
          logger.debug(`[RedisStorage] Raw data type for chain ${chainId}: ${typeof rawData}`);
          logger.debug(`[RedisStorage] Raw data sample for chain ${chainId}: ${JSON.stringify(rawData).substring(0, 200)}`);
          
          // Handle both string and object responses from Redis
          if (typeof rawData === 'string') {
            chainData = JSON.parse(rawData) as ChainPriceData;
          } else {
            chainData = rawData as ChainPriceData;
          }
          
          const chainMap = new Map<string, Price>();
          
          logger.debug(`[RedisStorage] Chain data keys for chain ${chainId}: ${Object.keys(chainData).slice(0, 5).join(', ')}...`);
          
          for (const [, entry] of Object.entries(chainData)) {
            if (!entry || typeof entry !== 'object') {
              logger.warn(`[RedisStorage] Invalid entry in chain ${chainId}:`, entry);
              continue;
            }
            
            if (typeof entry.price === 'string') {
              entry.price = BigInt(entry.price);
            }
            const { timestamp, ...price } = entry;
            chainMap.set(price.address, price);
          }
          
          if (chainMap.size > 0) {
            logger.info(`[RedisStorage] Found ${chainMap.size} prices for chain ${chainId}`);
            allPrices.set(chainId, chainMap);
          } else {
            logger.warn(`[RedisStorage] No prices found for chain ${chainId}`);
          }
        } catch (error) {
          logger.error(`[RedisStorage] Failed to parse chain data for chain ${chainId}:`, error);
        }
      } else {
        logger.debug(`[RedisStorage] No data found for chain ${chainId}`);
      }
    }
    
    logger.info(`[RedisStorage] Final result: ${allPrices.size} chains with prices`);
    return allPrices;
  }

  public async clearCache(chainId?: number): Promise<void> {
    if (chainId) {
      await this.redis.del(this.getChainKey(chainId));
      logger.info(`Cleared prices for chain ${chainId}`);
    } else {
      // Clear all chains
      const chainIds = Object.values(SUPPORTED_CHAINS).map(c => c.id);
      const pipeline = this.redis.pipeline();
      
      for (const id of chainIds) {
        pipeline.del(this.getChainKey(id));
      }
      
      await pipeline.exec();
      logger.info(`Cleared prices for all chains`);
    }
  }

  public async getStats(chainId?: number): Promise<any> {
    if (chainId) {
      const chainData = await this.getChainData(chainId);
      return {
        priceCount: chainData ? Object.keys(chainData).length : 0,
        chainId
      };
    }
    
    const stats: Record<number, any> = {};
    for (const chain of Object.values(SUPPORTED_CHAINS)) {
      stats[chain.id] = await this.getStats(chain.id);
    }
    return stats;
  }

  /**
   * Load backup data from file storage into Redis
   * This is useful for migrating from file to Redis storage
   */
  public async loadFromFileBackup(backupDir: string): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');
    
    try {
      if (!fs.existsSync(backupDir)) {
        logger.warn(`Backup directory ${backupDir} does not exist`);
        return;
      }

      let totalLoaded = 0;
      
      for (const chain of Object.values(SUPPORTED_CHAINS)) {
        const backupFile = path.join(backupDir, `chain_${chain.id}.json`);
        if (!fs.existsSync(backupFile)) continue;
        
        const fileData = fs.readFileSync(backupFile, 'utf8');
        const rawPrices = JSON.parse(fileData);
        
        // Handle both old format (Record<string, PriceCacheEntry>) and new format
        const chainData: ChainPriceData = {};
        
        // Check if it's already in the new format (object with address keys)
        const entries = Object.entries(rawPrices);
        for (const [key, value] of entries) {
          // Determine if this is an address or some other key
          const isAddress = key.startsWith('0x') && key.length === 42;
          
          if (isAddress && value && typeof value === 'object') {
            const entry = value as any;
            if (typeof entry.price === 'string') {
              entry.price = BigInt(entry.price);
            }
            chainData[key.toLowerCase()] = {
              ...entry,
              address: key.toLowerCase(),
              timestamp: entry.timestamp || Date.now()
            };
          }
        }
        
        // Store entire chain data at once
        const key = this.getChainKey(chain.id);
        const dataStr = JSON.stringify(chainData, (_, v) => 
          typeof v === 'bigint' ? v.toString() : v
        );
        
        if (this.cacheTTL > 0) {
          await this.redis.setex(key, this.cacheTTL, dataStr);
        } else {
          await this.redis.set(key, dataStr);
        }
        
        const priceCount = Object.keys(chainData).length;
        if (priceCount > 0) {
          logger.info(`Loaded ${priceCount} prices for chain ${chain.id} from backup`);
          totalLoaded += priceCount;
        }
      }
      
      if (totalLoaded > 0) {
        logger.info(`📊 Total prices loaded from backup into Redis: ${totalLoaded}`);
      }
    } catch (error) {
      logger.error(`Failed to load backup data into Redis:`, error);
    }
  }
}