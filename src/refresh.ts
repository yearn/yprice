import dotenv from 'dotenv';
import { initializeStorage, StorageType } from './storage';
import priceService from './services/priceService';
import { logger } from './utils';

dotenv.config();

async function refresh() {
  try {
    // Initialize storage with same settings as main server
    const cacheTTL = parseInt(process.env.CACHE_TTL_SECONDS || '0');
    const storageType = (process.env.STORAGE_TYPE || 'file') as StorageType;
    const backupDir = './data/prices';
    
    initializeStorage(storageType, cacheTTL, backupDir);
    
    logger.info('🚀 Starting manual price refresh...');
    logger.info('This may take several minutes to complete all chains.');
    
    // Run the price fetch once
    await priceService.fetchOnce();
    
    logger.info(`💾 Prices have been saved to ${storageType === 'redis' ? 'Redis' : 'data/prices/'}`);
    process.exit(0);
  } catch (error) {
    logger.error('Failed to refresh prices:', error);
    process.exit(1);
  }
}

// Handle termination
process.on('SIGINT', () => {
  logger.info('Price refresh interrupted by user');
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('Price refresh terminated');
  process.exit(1);
});

// Run the refresh
refresh();