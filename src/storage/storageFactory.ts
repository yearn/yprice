import { PriceStorage } from 'storage/priceStorage'
import { RedisStorage } from 'storage/redisStorage'
import { StorageInterface } from 'storage/storageInterface'
import { logger } from 'utils/index'

export type StorageType = 'file' | 'redis'

let storageInstance: StorageInterface | null = null
let currentStorageType: StorageType | null = null

export function initializeStorage(
  type: StorageType = 'file',
  cacheTTL?: number,
  backupDir?: string,
): StorageInterface {
  if (storageInstance && currentStorageType === type) {
    return storageInstance
  }

  switch (type) {
    case 'redis':
      try {
        const onCircuitOpen = () => fallbackToFileStorage(cacheTTL, backupDir)
        storageInstance = new RedisStorage(cacheTTL, onCircuitOpen)
        currentStorageType = 'redis'
        logger.info('Using Redis storage for prices')
      } catch (error) {
        logger.error('Failed to initialize Redis storage:', error)
        logger.warn('Falling back to file storage')
        storageInstance = new PriceStorage(cacheTTL, backupDir)
        currentStorageType = 'file'
      }
      break
    default:
      storageInstance = new PriceStorage(cacheTTL, backupDir)
      currentStorageType = 'file'
      logger.info('Using file storage for prices')
      break
  }

  return storageInstance
}

function fallbackToFileStorage(cacheTTL?: number, backupDir?: string): void {
  logger.warn('Redis circuit breaker tripped — falling back to file storage')
  storageInstance = new PriceStorage(cacheTTL, backupDir)
  currentStorageType = 'file'
}

export function getStorage(): StorageInterface {
  if (!storageInstance) {
    throw new Error('Storage not initialized. Call initializeStorage first.')
  }
  return storageInstance
}

export function getCurrentStorageType(): StorageType | null {
  return currentStorageType
}
