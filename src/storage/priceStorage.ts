import NodeCache from 'node-cache';
import { Price, ChainConfig, SUPPORTED_CHAINS } from '../models';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils';

interface PriceCacheEntry extends Price {
  timestamp: number;
}

export class PriceStorage {
  private caches: Map<number, NodeCache>;
  private cacheTTL: number;
  private backupDir: string;

  constructor(cacheTTL: number = 60, backupDir: string = './data/prices') {
    this.caches = new Map();
    this.cacheTTL = cacheTTL;
    this.backupDir = backupDir;
    this.initializeCaches();
    this.loadBackupData();
  }

  private initializeCaches(): void {
    Object.values(SUPPORTED_CHAINS).forEach((chain: ChainConfig) => {
      this.caches.set(chain.id, new NodeCache({ 
        stdTTL: this.cacheTTL,
        checkperiod: this.cacheTTL * 2,
        useClones: false
      }));
    });
  }

  private loadBackupData(): void {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
        return;
      }

      Object.values(SUPPORTED_CHAINS).forEach((chain: ChainConfig) => {
        const backupFile = path.join(this.backupDir, `chain_${chain.id}.json`);
        if (fs.existsSync(backupFile)) {
          const data = fs.readFileSync(backupFile, 'utf8');
          const prices: Record<string, PriceCacheEntry> = JSON.parse(data);
          const cache = this.caches.get(chain.id);
          
          if (cache) {
            Object.entries(prices).forEach(([address, price]) => {
              // Convert string back to BigInt for price field
              if (typeof price.price === 'string') {
                price.price = BigInt(price.price);
              }
              const ageMs = Date.now() - price.timestamp;
              const remainingTTL = Math.max(0, this.cacheTTL * 1000 - ageMs);
              if (remainingTTL > 0) {
                cache.set(address.toLowerCase(), price, remainingTTL / 1000);
              }
            });
          }
        }
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.warn(`Failed to load backup data: ${(errorMsg || "Unknown error").substring(0, 100)}`);
    }
  }

  public storePrice(chainId: number, price: Price): void {
    const cache = this.caches.get(chainId);
    if (!cache) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const entry: PriceCacheEntry = {
      ...price,
      address: price.address.toLowerCase(),
      timestamp: Date.now()
    };

    cache.set(entry.address, entry);
    this.persistToBackup(chainId);
  }

  public storePrices(chainId: number, prices: Price[]): void {
    const cache = this.caches.get(chainId);
    if (!cache) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const entries = prices.map(price => ({
      key: price.address.toLowerCase(),
      val: {
        ...price,
        address: price.address.toLowerCase(),
        timestamp: Date.now()
      } as PriceCacheEntry,
      ttl: this.cacheTTL
    }));

    cache.mset(entries);
    this.persistToBackup(chainId);
  }

  public getPrice(chainId: number, address: string): Price | undefined {
    const cache = this.caches.get(chainId);
    if (!cache) {
      return undefined;
    }

    const entry = cache.get<PriceCacheEntry>(address.toLowerCase());
    if (!entry) {
      return undefined;
    }

    const { timestamp, ...price } = entry;
    return price;
  }

  public listPrices(chainId: number): { asMap: Map<string, Price>, asSlice: Price[] } {
    const cache = this.caches.get(chainId);
    const asMap = new Map<string, Price>();
    const asSlice: Price[] = [];

    if (!cache) {
      return { asMap, asSlice };
    }

    const keys = cache.keys();
    keys.forEach(key => {
      const entry = cache.get<PriceCacheEntry>(key);
      if (entry) {
        const { timestamp, ...price } = entry;
        asMap.set(price.address, price);
        asSlice.push(price);
      }
    });

    return { asMap, asSlice };
  }

  public getAllPrices(): Map<number, Map<string, Price>> {
    const allPrices = new Map<number, Map<string, Price>>();
    
    Object.values(SUPPORTED_CHAINS).forEach((chain: ChainConfig) => {
      const { asMap } = this.listPrices(chain.id);
      if (asMap.size > 0) {
        allPrices.set(chain.id, asMap);
      }
    });

    return allPrices;
  }

  private persistToBackup(chainId: number): void {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      const cache = this.caches.get(chainId);
      if (!cache) return;

      const prices: Record<string, PriceCacheEntry> = {};
      const keys = cache.keys();
      
      keys.forEach(key => {
        const entry = cache.get<PriceCacheEntry>(key);
        if (entry) {
          prices[key] = entry;
        }
      });

      const backupFile = path.join(this.backupDir, `chain_${chainId}.json`);
      // Convert BigInt to strings for JSON serialization
      const serializable = JSON.stringify(prices, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value, 2
      );
      fs.writeFileSync(backupFile, serializable);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.warn(`Failed to persist backup for chain ${chainId}: ${(errorMsg || "Unknown error").substring(0, 100)}`);
    }
  }

  public clearCache(chainId?: number): void {
    if (chainId) {
      const cache = this.caches.get(chainId);
      cache?.flushAll();
    } else {
      this.caches.forEach(cache => cache.flushAll());
    }
  }

  public getStats(chainId?: number): any {
    if (chainId) {
      const cache = this.caches.get(chainId);
      return cache?.getStats();
    } else {
      const stats: any = {};
      this.caches.forEach((cache, id) => {
        stats[id] = cache.getStats();
      });
      return stats;
    }
  }
}

let storage: PriceStorage | null = null;

export function initializePriceStorage(cacheTTL?: number, backupDir?: string): PriceStorage {
  if (!storage) {
    storage = new PriceStorage(cacheTTL, backupDir);
  }
  return storage;
}

export function getPriceStorage(): PriceStorage {
  if (!storage) {
    throw new Error('Price storage not initialized. Call initializePriceStorage first.');
  }
  return storage;
}