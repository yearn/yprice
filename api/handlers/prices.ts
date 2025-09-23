import { initializeStorage, StorageWrapper, getStorage, StorageType } from '../../dist/storage/index';
import { logger } from '../../dist/utils';

// Initialize storage once when the function loads
let storageInitialized = false;
function ensureStorageInitialized() {
  if (!storageInitialized) {
    const cacheTTL = parseInt(process.env.CACHE_TTL_SECONDS || '0');
    const storageType = (process.env.STORAGE_TYPE || 'redis') as StorageType;
    
    logger.info(`[API] Initializing storage with type: ${storageType}, cacheTTL: ${cacheTTL}`);
    logger.debug(`[API] Redis URL: ${process.env.UPSTASH_REDIS_REST_URL ? 'SET' : 'NOT SET'}`);
    logger.debug(`[API] Redis Token: ${process.env.UPSTASH_REDIS_REST_TOKEN ? 'SET' : 'NOT SET'}`);
    
    initializeStorage(storageType, cacheTTL);
    storageInitialized = true;
  }
}

export async function pricesHandler(method: string | undefined) {
  if (method !== 'GET') {
    return {
      status: 405,
      body: { error: 'Method not allowed' }
    };
  }

  try {
    ensureStorageInitialized();
    const storage = new StorageWrapper(getStorage());
    const allPrices = await storage.getAllPrices();
    const response: any = {};
    
    allPrices.forEach((chainPrices, chainId) => {
      const chainDict: any = {};
      
      chainPrices.forEach((price, address) => {
        chainDict[address.toLowerCase()] = price.price.toString();
      });
      
      response[chainId.toString()] = chainDict;
    });
    
    return {
      status: 200,
      body: response,
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate'
      }
    };
  } catch (error) {
    logger.error('Error fetching all prices:', error);
    return {
      status: 500,
      body: { error: 'Internal server error' }
    };
  }
}