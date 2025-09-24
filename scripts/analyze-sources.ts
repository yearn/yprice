import dotenv from 'dotenv'
import { initializeStorage, StorageType, getStorage, StorageWrapper } from 'storage/index'
import { logger } from 'utils/index'
import { SUPPORTED_CHAINS } from 'models/types'
import { chainDiscoveryServices, chainFetchers, DISCOVERY_CONFIGS } from 'discovery/config'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import axios from 'axios'
import path from 'path'
import tokenDiscoveryService from 'discovery/tokenDiscoveryService'
import { PriceFetcherOrchestrator } from 'fetchers/index'
import { Price } from 'models/index'

dotenv.config()

interface YdaemonPrice {
  [address: string]: string
}

interface SourceAnalysis {
  tokens_found: number
  coverage_pct: number
  accurate_prices: number
  accuracy_pct: number
  avg_price_diff_pct: number
  missing_tokens: string[]
  extra_tokens: string[]
}

interface SummaryReport {
  chain: number
  timestamp: string
  ydaemon_total_tokens: number
  sources: Record<string, SourceAnalysis>
}

// Ydaemon API endpoints by chain
const YDAEMON_ENDPOINTS: Record<number, string> = {
  1: 'https://ydaemon.yearn.fi/1/prices/all',
  10: 'https://ydaemon.yearn.fi/10/prices/all',
  137: 'https://ydaemon.yearn.fi/137/prices/all',
  250: 'https://ydaemon.yearn.fi/250/prices/all',
  8453: 'https://ydaemon.yearn.fi/8453/prices/all',
  42161: 'https://ydaemon.yearn.fi/42161/prices/all',
}

async function fetchYdaemonPrices(chainId: number): Promise<Map<string, number>> {
  const endpoint = YDAEMON_ENDPOINTS[chainId]
  if (!endpoint) {
    throw new Error(`No ydaemon endpoint configured for chain ${chainId}`)
  }

  logger.info(`Fetching baseline prices from ydaemon for chain ${chainId}...`)

  try {
    const response = await axios.get<YdaemonPrice>(endpoint, {
      timeout: 30000,
      headers: { 'User-Agent': 'yprice-analyzer' },
    })

    const prices = new Map<string, number>()

    Object.entries(response.data).forEach(([address, priceStr]) => {
      // Ydaemon returns prices as strings with 6 decimals (e.g., "2653230000" for $2653.23)
      const priceScaled = parseFloat(priceStr)
      if (priceScaled > 0) {
        // Convert to USD by dividing by 1e6
        const priceUsd = priceScaled / 1e6
        prices.set(address.toLowerCase(), priceUsd)
      }
    })

    logger.info(`Fetched ${prices.size} prices from ydaemon`)
    return prices
  } catch (error) {
    logger.error('Failed to fetch ydaemon prices:', error)
    throw error
  }
}

async function runSourceForChain(
  chainId: number,
  route: string,
  allChainTokens?: any[],
): Promise<void> {
  logger.info(`Running ${route} for chain ${chainId}...`)

  const discoveryServices = chainDiscoveryServices[chainId] || []
  const fetchers = chainFetchers[chainId] || []

  const isDiscoveryService = discoveryServices.includes(route)
  const isFetcher = fetchers.includes(route)

  if (!isDiscoveryService && !isFetcher) {
    throw new Error(`Route '${route}' is not available for chain ${chainId}`)
  }

  const storage = new StorageWrapper(getStorage())

  if (isDiscoveryService) {
    // Run only the specific discovery service for this chain
    logger.info(`Running discovery service: ${route}`)
    const tokens = await tokenDiscoveryService.discoverTokensForService(chainId, route)
    const chainTokens = tokens.get(chainId)

    if (!chainTokens || chainTokens.length === 0) {
      logger.warn(`No tokens found for chain ${chainId} with discovery service ${route}`)
      return
    }

    logger.info(`Discovered ${chainTokens.length} tokens, fetching prices...`)

    // Fetch prices for discovered tokens
    const fetcher = new PriceFetcherOrchestrator()
    const prices = await fetcher.fetchPrices(chainId, chainTokens)

    // Store prices
    const pricesArray = Array.from(prices.values())
    if (pricesArray.length > 0) {
      await storage.storePrices(chainId, pricesArray)
    }

    logger.info(`Found prices for ${prices.size} tokens`)
  } else {
    // For price fetchers, use provided tokens or discover once
    let tokens = allChainTokens

    if (!tokens) {
      logger.info(`No tokens provided, discovering tokens for chain ${chainId}...`)
      const tokensByChain = await tokenDiscoveryService.discoverTokensForService(
        chainId,
        'tokenlist',
      )
      tokens = tokensByChain.get(chainId)
    }

    if (!tokens || tokens.length === 0) {
      logger.warn(`No tokens found for chain ${chainId}`)
      return
    }

    logger.info(`Using ${tokens.length} tokens, fetching prices with ${route}...`)

    // Create a fetcher that only uses the specified source
    const fetcher = new PriceFetcherOrchestrator()
    fetcher.setFetcherFilter(route)

    const prices = await fetcher.fetchPrices(chainId, tokens)

    // Store prices
    const pricesArray = Array.from(prices.values())
    if (pricesArray.length > 0) {
      await storage.storePrices(chainId, pricesArray)
    }

    logger.info(`Found prices for ${prices.size} tokens`)
  }
}

async function getSourcePrices(chainId: number): Promise<Map<string, number>> {
  const storage = new StorageWrapper(getStorage())
  const { asSlice } = await storage.listPrices(chainId)

  const prices = new Map<string, number>()
  asSlice.forEach((price) => {
    // Convert to USD (6 decimal places)
    const priceUsd = Number(price.price) / 1e6
    prices.set(price.address.toLowerCase(), priceUsd)
  })

  return prices
}

function calculatePriceDifference(sourcePrice: number, ydaemonPrice: number): number {
  if (ydaemonPrice === 0) return 100
  return Math.abs(((sourcePrice - ydaemonPrice) / ydaemonPrice) * 100)
}

function analyzeSource(
  sourceName: string,
  sourcePrices: Map<string, number>,
  ydaemonPrices: Map<string, number>,
  outputDir: string,
  accuracyThreshold: number = 5,
): SourceAnalysis {
  const csvRows: string[] = [
    'address,source_price_usd,ydaemon_price_usd,price_diff_pct,match_status',
  ]

  let accurateCount = 0
  let totalDiffPct = 0
  let comparedCount = 0

  const sourceAddresses = new Set(sourcePrices.keys())
  const ydaemonAddresses = new Set(ydaemonPrices.keys())

  // Find common addresses and calculate differences
  sourcePrices.forEach((sourcePrice, address) => {
    const ydaemonPrice = ydaemonPrices.get(address)

    if (ydaemonPrice !== undefined) {
      const diffPct = calculatePriceDifference(sourcePrice, ydaemonPrice)
      const matchStatus = diffPct <= accuracyThreshold ? 'accurate' : 'divergent'

      if (diffPct <= accuracyThreshold) {
        accurateCount++
      }

      totalDiffPct += diffPct
      comparedCount++

      csvRows.push(
        `"${address}","${sourcePrice.toFixed(6)}","${ydaemonPrice.toFixed(6)}","${diffPct.toFixed(2)}","${matchStatus}"`,
      )
    } else {
      csvRows.push(`"${address}","${sourcePrice.toFixed(6)}","","","extra"`)
    }
  })

  // Find missing tokens (in ydaemon but not in source)
  const missingTokens: string[] = []
  ydaemonPrices.forEach((_, address) => {
    if (!sourcePrices.has(address)) {
      missingTokens.push(address)
      csvRows.push(`"${address}","","${ydaemonPrices.get(address)?.toFixed(6)}","","missing"`)
    }
  })

  // Save CSV
  const csvFilename = path.join(outputDir, `${sourceName}.csv`)
  writeFileSync(csvFilename, csvRows.join('\n'))
  logger.info(`Saved analysis to ${csvFilename}`)

  // Calculate metrics
  const tokensFound = sourcePrices.size
  const coveragePct = (sourcePrices.size / ydaemonPrices.size) * 100
  const accuracyPct = comparedCount > 0 ? (accurateCount / comparedCount) * 100 : 0
  const avgDiffPct = comparedCount > 0 ? totalDiffPct / comparedCount : 0

  const extraTokens = Array.from(sourceAddresses).filter((addr) => !ydaemonAddresses.has(addr))

  return {
    tokens_found: tokensFound,
    coverage_pct: parseFloat(coveragePct.toFixed(2)),
    accurate_prices: accurateCount,
    accuracy_pct: parseFloat(accuracyPct.toFixed(2)),
    avg_price_diff_pct: parseFloat(avgDiffPct.toFixed(2)),
    missing_tokens: missingTokens,
    extra_tokens: extraTokens,
  }
}

async function analyzeSources() {
  try {
    // Parse command line arguments
    const chainIdArg = process.argv[2]

    if (!chainIdArg) {
      console.log('Usage: analyze-sources <chainId>')
      console.log('Example: analyze-sources 1')
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

    // Initialize storage
    const cacheTTL = parseInt(process.env.CACHE_TTL_SECONDS || '0', 10)
    const storageType = (process.env.STORAGE_TYPE || 'file') as StorageType
    const backupDir = './data/prices'

    initializeStorage(storageType, cacheTTL, backupDir)

    // Create output directory
    const timestamp = new Date().toISOString().split('T')[0]
    const outputDir = `output/analyze-sources-${chainId}-${timestamp}`
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    // Fetch baseline prices from ydaemon
    const ydaemonPrices = await fetchYdaemonPrices(chainId)

    // Get all sources for this chain
    const discoveryServices = chainDiscoveryServices[chainId] || []
    const priceFetchers = chainFetchers[chainId] || []
    const allSources = [...discoveryServices, ...priceFetchers]

    logger.info(`Analyzing ${allSources.length} sources for chain ${chainId}`)

    // Initialize summary report
    const summaryReport: SummaryReport = {
      chain: chainId,
      timestamp: new Date().toISOString(),
      ydaemon_total_tokens: ydaemonPrices.size,
      sources: {},
    }

    // Clear existing prices before starting
    const storage = new StorageWrapper(getStorage())
    await storage.clearCache(chainId)

    // Pre-discover tokens for price fetchers (using tokenlist as a baseline)
    let baselineTokens = null
    if (priceFetchers.length > 0) {
      logger.info(`\n📊 Pre-discovering tokens for chain ${chainId} to use with price fetchers...`)
      try {
        const tokensByChain = await tokenDiscoveryService.discoverTokensForService(
          chainId,
          'tokenlist',
        )
        baselineTokens = tokensByChain.get(chainId)
        logger.info(`Discovered ${baselineTokens?.length || 0} baseline tokens`)
      } catch (error) {
        logger.warn(`Failed to pre-discover tokens: ${error}`)
      }
    }

    // Analyze each source
    for (const source of allSources) {
      logger.info(`\n🔄 Analyzing source: ${source}`)

      try {
        // Clear cache before each run to ensure clean data
        await storage.clearCache(chainId)

        // Check if this is a price fetcher and we have baseline tokens
        const isPriceFetcher = priceFetchers.includes(source)

        // Run source for this specific chain only
        await runSourceForChain(chainId, source, isPriceFetcher ? baselineTokens : undefined)

        // Get prices from storage
        const sourcePrices = await getSourcePrices(chainId)

        // Analyze and save results
        const analysis = analyzeSource(source, sourcePrices, ydaemonPrices, outputDir)
        summaryReport.sources[source] = analysis

        logger.info(
          `✅ ${source}: Found ${analysis.tokens_found} tokens, Coverage: ${analysis.coverage_pct}%, Accuracy: ${analysis.accuracy_pct}%`,
        )
      } catch (error) {
        logger.error(`Failed to analyze ${source}:`, error)
        summaryReport.sources[source] = {
          tokens_found: 0,
          coverage_pct: 0,
          accurate_prices: 0,
          accuracy_pct: 0,
          avg_price_diff_pct: 0,
          missing_tokens: [],
          extra_tokens: [],
        }
      }
    }

    // Save summary report
    const summaryPath = path.join(outputDir, 'summary-report.json')
    writeFileSync(summaryPath, JSON.stringify(summaryReport, null, 2))
    logger.info(`\n📊 Summary report saved to ${summaryPath}`)

    // Print summary
    console.log('\n📈 Analysis Summary:')
    console.log(`Chain: ${chainId}`)
    console.log(`Ydaemon Total Tokens: ${ydaemonPrices.size}`)
    console.log('\nSource Performance:')

    Object.entries(summaryReport.sources)
      .sort((a, b) => b[1].coverage_pct - a[1].coverage_pct)
      .forEach(([source, analysis]) => {
        console.log(`\n${source}:`)
        console.log(
          `  Coverage: ${analysis.coverage_pct}% (${analysis.tokens_found}/${ydaemonPrices.size} tokens)`,
        )
        console.log(
          `  Accuracy: ${analysis.accuracy_pct}% (${analysis.accurate_prices}/${analysis.tokens_found} within 5%)`,
        )
        console.log(`  Avg Price Diff: ${analysis.avg_price_diff_pct}%`)
      })

    process.exit(0)
  } catch (error) {
    logger.error('Analysis failed:', error)
    process.exit(1)
  }
}

// Run the analysis
analyzeSources()
