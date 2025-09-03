import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeStorage, StorageWrapper, getStorage, StorageType } from '../src/storage/index';
import { logger } from '../src/utils';

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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
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
    
    // Set cache headers for better performance
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(response);
  } catch (error) {
    logger.error('Error fetching all prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}