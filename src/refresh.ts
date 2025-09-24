import dotenv from 'dotenv'
import priceService from 'services/priceService'
import { initializeStorage, StorageType } from 'storage/index'
import { logger } from 'utils/index'

dotenv.config()

async function refresh() {
  try {
    // Initialize storage with same settings as main server
    const cacheTTL = parseInt(process.env.CACHE_TTL_SECONDS || '0', 10)
    const storageType = (process.env.STORAGE_TYPE || 'file') as StorageType
    const backupDir = './data/prices'

    initializeStorage(storageType, cacheTTL, backupDir)

    // Get chain ID from command line argument
    const chainId = process.argv[2] ? parseInt(process.argv[2], 10) : undefined

    if (chainId) {
      logger.info(`🚀 Starting price refresh for chain ${chainId}...`)
      await priceService.fetchPricesForChain(chainId)
    } else {
      logger.info('🚀 Starting manual price refresh for all chains...')
      logger.info('This may take several minutes to complete all chains.')
      await priceService.fetchOnce()
    }

    logger.info(
      `💾 Prices have been saved to ${storageType === 'redis' ? 'Redis' : 'data/prices/'}`,
    )
    process.exit(0)
  } catch (error) {
    logger.error('Failed to refresh prices:', error)
    process.exit(1)
  }
}

// Handle termination
process.on('SIGINT', () => {
  logger.info('Price refresh interrupted by user')
  process.exit(1)
})

process.on('SIGTERM', () => {
  logger.info('Price refresh terminated')
  process.exit(1)
})

// Run the refresh
refresh()
