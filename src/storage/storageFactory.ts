import { StorageInterface } from './storageInterface';
import { PriceStorage } from './priceStorage';
import { RedisStorage } from './redisStorage';
import { logger } from '../utils';
import { Price } from '../models';

export type StorageType = 'file' | 'redis';

let storageInstance: StorageInterface | null = null;
let currentStorageType: StorageType | null = null;

export function initializeStorage(
  type: StorageType = 'file',
  cacheTTL?: number,
  backupDir?: string
): StorageInterface {
  // If already initialized with same type, return existing instance
  if (storageInstance && currentStorageType === type) {
    return storageInstance;
  }

  // Create new storage instance based on type
  switch (type) {
    case 'redis':
      try {
        storageInstance = new RedisStorage(cacheTTL);
        currentStorageType = 'redis';
        logger.info('Using Redis storage for prices');
        
        // Don't load backup here - it will be done asynchronously after initialization
        // The Redis storage will check and load as needed
      } catch (error) {
        logger.error('Failed to initialize Redis storage:', error);
        logger.warn('Falling back to file storage');
        storageInstance = new PriceStorage(cacheTTL, backupDir);
        currentStorageType = 'file';
      }
      break;
      
    case 'file':
    default:
      storageInstance = new PriceStorage(cacheTTL, backupDir);
      currentStorageType = 'file';
      logger.info('Using file storage for prices');
      break;
  }

  return storageInstance;
}

export function getStorage(): StorageInterface {
  if (!storageInstance) {
    throw new Error('Storage not initialized. Call initializeStorage first.');
  }
  return storageInstance;
}

export function getCurrentStorageType(): StorageType | null {
  return currentStorageType;
}

// Wrapper class to handle async operations transparently
export class StorageWrapper implements StorageInterface {
  private storage: StorageInterface;

  constructor(storage: StorageInterface) {
    this.storage = storage;
  }

  async storePrice(chainId: number, price: Price): Promise<void> {
    await this.storage.storePrice(chainId, price);
  }

  async storePrices(chainId: number, prices: Price[]): Promise<void> {
    await this.storage.storePrices(chainId, prices);
  }

  async getPrice(chainId: number, address: string): Promise<Price | undefined> {
    return await this.storage.getPrice(chainId, address);
  }

  async listPrices(chainId: number): Promise<{ asMap: Map<string, Price>, asSlice: Price[] }> {
    return await this.storage.listPrices(chainId);
  }

  async getAllPrices(): Promise<Map<number, Map<string, Price>>> {
    return await this.storage.getAllPrices();
  }

  async clearCache(chainId?: number): Promise<void> {
    await this.storage.clearCache(chainId);
  }

  async getStats(chainId?: number): Promise<any> {
    return await this.storage.getStats(chainId);
  }
}