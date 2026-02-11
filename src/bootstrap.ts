import dotenv from 'dotenv'
import { initializeStorage, StorageType } from 'storage/index'
import { logger } from 'utils/index'

dotenv.config()

export function bootstrap(): { storageType: StorageType } {
  const cacheTTL = parseInt(process.env.CACHE_TTL_SECONDS || '0', 10)
  const storageType = (process.env.STORAGE_TYPE || 'file') as StorageType
  const backupDir = './data/prices'

  initializeStorage(storageType, cacheTTL, backupDir)
  return { storageType }
}

export function setupSignalHandlers(): void {
  process.on('SIGINT', () => {
    logger.info('Price refresh interrupted by user')
    process.exit(1)
  })

  process.on('SIGTERM', () => {
    logger.info('Price refresh terminated')
    process.exit(1)
  })
}
