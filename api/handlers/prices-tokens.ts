import { initializeStorage, StorageWrapper, getStorage, StorageType } from '../../dist/storage/index';
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

export async function pricesTokensHandler(method: string | undefined, list: string | undefined) {
  if (method !== 'GET') {
    return {
      status: 405,
      body: { error: 'Method not allowed' }
    };
  }

  try {
    const tokens = list as string;
    
    // Check if this is actually a single chainId (numeric)
    if (!isNaN(Number(tokens))) {
      // This should be handled by the [chainId] route
      return {
        status: 400,
        body: { error: 'Use /prices/[chainId] for chain-specific queries' }
      };
    }
    
    ensureStorageInitialized();
    const storage = new StorageWrapper(getStorage());
    const response: any = {};
    
    // Parse token list: "1:0xabc,10:0xdef,137:0x123"
    const tokenList = tokens.split(',');
    
    for (const token of tokenList) {
      const [chainIdStr, address] = token.split(':');
      const chainId = parseInt(chainIdStr || '');
      
      if (chainId && address) {
        const price = await storage.getPrice(chainId, address);
        if (price) {
          // Use the full chainId:address as the key
          response[`${chainId}:${address.toLowerCase()}`] = price.price.toString();
        }
      }
    }
    
    return {
      status: 200,
      body: response,
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate'
      }
    };
  } catch (error) {
    logger.error('Error fetching token prices:', error);
    return {
      status: 500,
      body: { error: 'Internal server error' }
    };
  }
}