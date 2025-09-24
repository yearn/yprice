import { writeFileSync } from 'node:fs'
import { chainDiscoveryServices, chainFetchers } from 'discovery/config'
import dotenv from 'dotenv'
import { SUPPORTED_CHAINS } from 'models/types'
import priceService from 'services/priceService'
import { getStorage, initializeStorage, StorageType, StorageWrapper } from 'storage/index'
import { logger } from 'utils/index'

dotenv.config()

async function refreshRoute() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2)
    const exportFlag = args.includes('--export') || args.includes('-e')
    const csvFlag = args.includes('--csv') || args.includes('-c')

    // Remove flags from args to get positional arguments
    const positionalArgs = args.filter((arg) => !arg.startsWith('-'))
    const [chainIdArg, route] = positionalArgs

    if (!chainIdArg || !route) {
      console.log('Usage: refresh-route <chainId> <route> [options]')
      console.log('Options:')
      console.log('  --export, -e    Export results to JSON file')
      console.log('  --csv, -c       Export results to CSV file')
      console.log('')
      console.log('Examples:')
      console.log('  refresh-route 1 curve-factories')
      console.log('  refresh-route 137 defillama --export')
      console.log('  refresh-route 10 velodrome --csv')
      process.exit(1)
    }

    const chainId = parseInt(chainIdArg, 10)

    // Validate chain ID
    const supportedChainIds = Object.values(SUPPORTED_CHAINS).map((chain) => chain.id)
    if (!supportedChainIds.includes(chainId)) {
      logger.error(
        `Chain ${chainId} is not supported. Supported chains: ${supportedChainIds.join(', ')}`,
      )
      process.exit(1)
    }

    // Validate route exists for this chain
    const discoveryServices = chainDiscoveryServices[chainId] || []
    const fetchers = chainFetchers[chainId] || []

    const isDiscoveryService = discoveryServices.includes(route)
    const isFetcher = fetchers.includes(route)

    if (!isDiscoveryService && !isFetcher) {
      logger.error(`Route '${route}' is not available for chain ${chainId}`)
      logger.info(`Available discovery services: ${discoveryServices.join(', ')}`)
      logger.info(`Available fetchers: ${fetchers.join(', ')}`)
      process.exit(1)
    }

    // Initialize storage with same settings as main server
    const cacheTTL = parseInt(process.env.CACHE_TTL_SECONDS || '0', 10)
    const storageType = (process.env.STORAGE_TYPE || 'file') as StorageType
    const backupDir = './data/prices'

    initializeStorage(storageType, cacheTTL, backupDir)

    logger.info(`🚀 Starting refresh for chain ${chainId} with route '${route}'...`)

    // Call the appropriate service method based on route type
    if (isDiscoveryService) {
      logger.info(`Running discovery service: ${route}`)
      await priceService.fetchPricesForChainAndDiscovery(chainId, route)
    } else {
      logger.info(`Running price fetcher: ${route}`)
      await priceService.fetchPricesForChainAndFetcher(chainId, route)
    }

    logger.info(
      `💾 Prices have been saved to ${storageType === 'redis' ? 'Redis' : 'data/prices/'}`,
    )

    // Export results if requested
    if (exportFlag || csvFlag) {
      const storage = new StorageWrapper(getStorage())
      const { asSlice } = await storage.listPrices(chainId)

      if (asSlice.length === 0) {
        logger.warn('No prices found to export')
      } else {
        const timestamp = new Date().toISOString().split('T')[0]
        const baseFilename = `refresh-route-${chainId}-${route}-${timestamp}`

        if (csvFlag) {
          // Export as CSV
          const headers = ['address', 'price_usd', 'price_wei', 'source', 'chain', 'route']
          const rows = asSlice.map((price) => {
            // Convert bigint price to USD (prices are stored with 6 decimals)
            const priceUsd = Number(price.price) / 1e6

            return [
              price.address,
              priceUsd.toFixed(6),
              price.price.toString(),
              price.source,
              chainId.toString(),
              route,
            ]
          })

          const csvContent = [
            headers.join(','),
            ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
          ].join('\n')

          const csvFilename = `${baseFilename}.csv`
          writeFileSync(csvFilename, csvContent)
          logger.info(`📄 Results exported to ${csvFilename}`)
        } else {
          // Export as JSON
          const jsonData = {
            metadata: {
              chain: chainId,
              route: route,
              timestamp: new Date().toISOString(),
              totalPrices: asSlice.length,
            },
            prices: asSlice.map((price) => ({
              address: price.address,
              priceUsd: Number(price.price) / 1e6,
              priceWei: price.price.toString(),
              source: price.source,
            })),
          }

          const jsonFilename = `${baseFilename}.json`
          writeFileSync(jsonFilename, JSON.stringify(jsonData, null, 2))
          logger.info(`📄 Results exported to ${jsonFilename}`)
        }
      }
    }

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
refreshRoute()
