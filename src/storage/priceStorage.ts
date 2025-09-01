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

      const loadedCounts = Object.values(SUPPORTED_CHAINS).map(({ id }) => {
        const backupFile = path.join(this.backupDir, `chain_${id}.json`);
        if (!fs.existsSync(backupFile)) return 0;
        
        const cache = this.caches.get(id);
        if (!cache) return 0;
        
        const prices: Record<string, PriceCacheEntry> = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
        
        const loadedPrices = Object.entries(prices).filter(([address, price]) => {
          if (typeof price.price === 'string') price.price = BigInt(price.price);
          
          // If cacheTTL is 0 (never expire), set without TTL
          // Otherwise calculate remaining TTL
          if (this.cacheTTL === 0) {
            cache.set(address.toLowerCase(), price);
            return true;
          } else {
            const remainingTTL = Math.max(0, this.cacheTTL * 1000 - (Date.now() - price.timestamp));
            if (remainingTTL > 0) {
              cache.set(address.toLowerCase(), price, remainingTTL / 1000);
              return true;
            }
            return false;
          }
        }).length;
        
        if (loadedPrices > 0) {
          logger.info(`Loaded ${loadedPrices} prices for chain ${id} from backup`);
        }
        
        return loadedPrices;
      });
      
      const totalLoaded = loadedCounts.reduce((sum, count) => sum + count, 0);
      if (totalLoaded > 0) {
        logger.info(`📊 Total prices loaded from backup: ${totalLoaded}`);
      }
    } catch (error) {
      logger.warn(`Failed to load backup data: ${error instanceof Error ? error.message : 'Unknown'}`.substring(0, 100));
    }
  }

  public storePrice(chainId: number, price: Price): void {
    this.storePrices(chainId, [price]);
  }

  public storePrices(chainId: number, prices: Price[]): void {
    const cache = this.caches.get(chainId);
    if (!cache) throw new Error(`Chain ${chainId} not supported`);

    const timestamp = Date.now();
    cache.mset(prices.map(price => ({
      key: price.address.toLowerCase(),
      val: { ...price, address: price.address.toLowerCase(), timestamp },
      ttl: this.cacheTTL
    })));
    
    this.persistToBackup(chainId);
  }

  public getPrice(chainId: number, address: string): Price | undefined {
    const entry = this.caches.get(chainId)?.get<PriceCacheEntry>(address.toLowerCase());
    if (!entry) return undefined;
    const { timestamp, ...price } = entry;
    return price;
  }

  public listPrices(chainId: number): { asMap: Map<string, Price>, asSlice: Price[] } {
    const cache = this.caches.get(chainId);
    if (!cache) return { asMap: new Map(), asSlice: [] };

    const asMap = new Map<string, Price>();
    const asSlice: Price[] = [];

    cache.keys().forEach(key => {
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
      if (!fs.existsSync(this.backupDir)) fs.mkdirSync(this.backupDir, { recursive: true });

      const cache = this.caches.get(chainId);
      if (!cache) return;

      const prices = Object.fromEntries(
        cache.keys().map(key => [key, cache.get<PriceCacheEntry>(key)]).filter(([, v]) => v)
      );

      fs.writeFileSync(
        path.join(this.backupDir, `chain_${chainId}.json`),
        JSON.stringify(prices, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)
      );
    } catch (error) {
      logger.warn(`Failed to persist backup for chain ${chainId}: ${error instanceof Error ? error.message : 'Unknown'}`.substring(0, 100));
    }
  }

  public clearCache(chainId?: number): void {
    chainId ? this.caches.get(chainId)?.flushAll() : this.caches.forEach(c => c.flushAll());
  }

  public getStats(chainId?: number): any {
    if (chainId) return this.caches.get(chainId)?.getStats();
    return Object.fromEntries(Array.from(this.caches.entries()).map(([id, cache]) => [id, cache.getStats()]));
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