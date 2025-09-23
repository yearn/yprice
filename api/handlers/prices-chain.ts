import { initializeStorage, StorageWrapper, getStorage, StorageType } from '../../dist/storage/index';
import { SUPPORTED_CHAINS } from '../../dist/models/index';
import { logger } from '../../dist/utils/index';

// Initialize storage once when the function loads
let storageInitialized = false;
function ensureStorageInitialized() {
  if (!storageInitialized) {
    const cacheTTL = parseInt(process.env.CACHE_TTL_SECONDS || '0');
    const storageType = (process.env.STORAGE_TYPE || 'redis') as StorageType;
    initializeStorage(storageType, cacheTTL);
    storageInitialized = true;
  }
}

export async function pricesChainHandler(method: string | undefined, chainIdParam: string | undefined) {
  if (method !== 'GET') {
    return {
      status: 405,
      body: { error: 'Method not allowed' }
    };
  }

  try {
    const chainId = parseInt(chainIdParam as string);
    
    // Validate chain ID
    if (!chainId || !Object.values(SUPPORTED_CHAINS).some((c: any) => c.id === chainId)) {
      return {
        status: 400,
        body: { error: 'Invalid chain ID' }
      };
    }
    
    ensureStorageInitialized();
    const storage = new StorageWrapper(getStorage());
    const { asMap } = await storage.listPrices(chainId);
    const response: any = {};
    
    asMap.forEach((price, address) => {
      response[address.toLowerCase()] = price.price.toString();
    });
    
    return {
      status: 200,
      body: response,
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate'
      }
    };
  } catch (error) {
    logger.error('Error fetching chain prices:', error);
    return {
      status: 500,
      body: { error: 'Internal server error' }
    };
  }
}