import { initializeStorage, getStorage, StorageType } from '../../dist/storage/index';
import type { StorageInterface } from '../../dist/storage/index';
import { logger } from '../../dist/utils/index';

let storageInitialized = false;

export function getInitializedStorage(): StorageInterface {
  if (!storageInitialized) {
    const cacheTTL = parseInt(process.env.CACHE_TTL_SECONDS || '0');
    const storageType = (process.env.STORAGE_TYPE || 'redis') as StorageType;

    logger.info(`[API] Initializing storage with type: ${storageType}, cacheTTL: ${cacheTTL}`);
    logger.debug(`[API] Redis URL: ${process.env.UPSTASH_REDIS_REST_URL ? 'SET' : 'NOT SET'}`);
    logger.debug(`[API] Redis Token: ${process.env.UPSTASH_REDIS_REST_TOKEN ? 'SET' : 'NOT SET'}`);

    initializeStorage(storageType, cacheTTL);
    storageInitialized = true;
  }
  return getStorage();
}
