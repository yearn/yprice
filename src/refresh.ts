import { bootstrap, setupSignalHandlers } from 'bootstrap'
import priceService from 'services/priceService'
import { logger } from 'utils/index'

const { storageType } = bootstrap()
setupSignalHandlers()

async function refresh() {
  try {
    // Get chain ID from command line argument
    const chainId = process.argv[2] ? parseInt(process.argv[2], 10) : undefined

    if (chainId) {
      logger.info(`Starting price refresh for chain ${chainId}...`)
      await priceService.fetchPricesForChain(chainId)
    } else {
      logger.info('Starting manual price refresh for all chains...')
      logger.info('This may take several minutes to complete all chains.')
      await priceService.fetchOnce()
    }

    logger.info(`Prices have been saved to ${storageType === 'redis' ? 'Redis' : 'data/prices/'}`)
    process.exit(0)
  } catch (error) {
    logger.error('Failed to refresh prices:', error)
    process.exit(1)
  }
}

refresh()
