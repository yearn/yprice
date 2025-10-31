import dotenv from 'dotenv'
// Ephemeral analyzer: no storage imports
import { logger } from 'utils/index'
import { SUPPORTED_CHAINS } from 'models/types'
import { chainDiscoveryServices, chainFetchers } from 'discovery/config'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import axios from 'axios'
import path from 'path'
import tokenDiscoveryService from 'discovery/tokenDiscoveryService'
import { PriceFetcherOrchestrator } from 'fetchers/index'
import { Price, ERC20Token } from 'models/index'

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
  durations_ms?: Record<string, number>
  slow_sources_ms?: { source: string; duration_ms: number }[]
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
  allChainTokens?: ERC20Token[],
  sharedPrices?: Map<string, Price>,
): Promise<Map<string, number>> {
  logger.info(`Running ${route} for chain ${chainId}...`)

  const discoveryServices = chainDiscoveryServices[chainId] || []
  const fetchers = chainFetchers[chainId] || []

  const isDiscoveryService = discoveryServices.includes(route)
  const isFetcher = fetchers.includes(route)

  if (!isDiscoveryService && !isFetcher) {
    throw new Error(`Route '${route}' is not available for chain ${chainId}`)
  }

  const toUsdMap = (prices: Map<string, Price>): Map<string, number> => {
    const result = new Map<string, number>()
    prices.forEach((p, addr) => {
      result.set(addr.toLowerCase(), Number(p.price) / 1e6)
    })
    return result
  }

  if (isDiscoveryService) {
    logger.info(`Running discovery service: ${route}`)
    const tokens = await tokenDiscoveryService.discoverTokensForService(chainId, route)
    const chainTokens = tokens.get(chainId) || []

    if (chainTokens.length === 0) {
      logger.warn(`No tokens found for chain ${chainId} with discovery service ${route}`)
      return new Map()
    }

    logger.info(`Discovered ${chainTokens.length} tokens, fetching prices...`)

    const fetcher = new PriceFetcherOrchestrator()
    const prices = await fetcher.fetchPrices(chainId, chainTokens, sharedPrices)
    logger.info(`Found prices for ${prices.size} tokens`)
    return toUsdMap(prices)
  } else {
    let tokens = allChainTokens
    if (!tokens) {
      logger.info(`No tokens provided, discovering tokens for chain ${chainId}...`)
      const tokensByChain = await tokenDiscoveryService.discoverTokensForService(
        chainId,
        'tokenlist',
      )
      tokens = tokensByChain.get(chainId) || []
    }

    if (!tokens || tokens.length === 0) {
      logger.warn(`No tokens found for chain ${chainId}`)
      return new Map()
    }

    logger.info(`Using ${tokens.length} tokens, fetching prices with ${route}...`)
    const fetcher = new PriceFetcherOrchestrator()
    fetcher.setFetcherFilter(route)
    const prices = await fetcher.fetchPrices(chainId, tokens, sharedPrices)
    logger.info(`Found prices for ${prices.size} tokens`)
    return toUsdMap(prices)
  }
}

function isOnChainHeavy(source: string): boolean {
  const heavy = new Set([
    'uniswap',
    'aave',
    'compound',
    'curve-factories',
    'curve-registries',
    'yearn',
    'curve-amm',
    'erc4626',
    'yearn-vault',
  ])
  return heavy.has(source)
}

function orderSources(sources: string[]): string[] {
  const priority: Record<string, number> = {
    defillama: 0,
    'curve-amm': 1,
    erc4626: 1,
    'yearn-vault': 1,
    uniswap: 2,
  }
  return [...sources].sort((a, b) => (priority[a] ?? 5) - (priority[b] ?? 5))
}

async function quickRpcProbe(chainId: number): Promise<boolean> {
  try {
    const envKey = `RPC_URI_FOR_${chainId}`
    const url = process.env[envKey]
    if (!url) return false
    const body = { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }
    const resp = await axios.post(url, body, { timeout: 2000 })
    return Boolean(resp?.data?.result)
  } catch {
    return false
  }
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, limit: number) {
  const queue = [...items]
  const running: Promise<void>[] = []
  while (queue.length > 0 || running.length > 0) {
    while (queue.length > 0 && running.length < limit) {
      const item = queue.shift() as T
      const p = worker(item).finally(() => {
        const idx = running.indexOf(p)
        if (idx >= 0) running.splice(idx, 1)
      })
      running.push(p)
    }
    if (running.length > 0) {
      await Promise.race(running)
    }
  }
}

// Removed storage round-trips; pricing stays in-memory for analysis

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
    const supportedChainIds = (Object.values(SUPPORTED_CHAINS) as Array<{ id: number }>).map(
      (chain) => chain.id,
    )
    if (!supportedChainIds.includes(chainId)) {
      logger.error(
        `Chain ${chainId} is not supported. Supported chains: ${supportedChainIds.join(', ')}`,
      )
      process.exit(1)
    }

    // Ephemeral run: no storage initialization

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
      durations_ms: {},
      slow_sources_ms: [],
    }

    // Pre-discover tokens for price fetchers (using tokenlist as a baseline) and prepare shared cache
    let baselineTokens: ERC20Token[] = []
    const sharedPrices: Map<string, Price> = new Map()
    if (priceFetchers.length > 0) {
      logger.info(`\n📊 Pre-discovering tokens for chain ${chainId} to use with price fetchers...`)
      try {
        const tokensByChain = await tokenDiscoveryService.discoverTokensForService(
          chainId,
          'tokenlist',
        )
        baselineTokens = tokensByChain.get(chainId) || []
        logger.info(`Discovered ${baselineTokens.length} baseline tokens`)
      } catch (error) {
        logger.warn(`Failed to pre-discover tokens: ${error}`)
      }
    }

    // Pre-warm with defillama if available to seed shared cache
    const sourcesSet = new Set(allSources)
    if (sourcesSet.has('defillama')) {
      try {
        const startIso = new Date().toISOString()
        const start = Date.now()
        logger.info(`[${startIso}] Start source: defillama (pre-warm) `)
        const prewarmPrices = await runSourceForChain(
          chainId,
          'defillama',
          baselineTokens ?? [],
          sharedPrices,
        )
        const end = Date.now()
        const duration = end - start
        const endIso = new Date().toISOString()
        summaryReport.durations_ms!['defillama'] = duration
        if (duration > 5000) {
          summaryReport.slow_sources_ms!.push({ source: 'defillama', duration_ms: duration })
          logger.warn(`[${endIso}] Done source: defillama in ${duration}ms (SLOW) `)
        } else {
          logger.info(`[${endIso}] Done source: defillama in ${duration}ms`)
        }
        // Merge prewarmed USD prices back into sharedPrices only as scaled values are needed by fetchers
        // We keep sharedPrices as Price map; defillama call already updated it internally via fetcher
        const analysis = analyzeSource('defillama', prewarmPrices, ydaemonPrices, outputDir)
        summaryReport.sources['defillama'] = analysis
        logger.info(
          `✅ defillama: Found ${analysis.tokens_found} tokens, Coverage: ${analysis.coverage_pct}%, Accuracy: ${analysis.accuracy_pct}%`,
        )
      } catch (error) {
        logger.error(`Failed to pre-warm defillama:`, error)
      }
    }

    // Order and possibly filter sources based on RPC health
    const onChainHealthy = await quickRpcProbe(chainId)
    const remainingSources = orderSources(allSources).filter((s) => s !== 'defillama')
    const filtered = remainingSources.filter((s) => onChainHealthy || !isOnChainHeavy(s))

    const PARALLELISM = 4

    await runPool(
      filtered,
      async (source) => {
        const startIso = new Date().toISOString()
        const start = Date.now()
        logger.info(`\n[${startIso}] Start source: ${source}`)
        try {
          const isPriceFetcher = priceFetchers.includes(source)
          const tokensForFetcher = isPriceFetcher ? (baselineTokens ?? []) : undefined
          const sourcePrices = await runSourceForChain(
            chainId,
            source,
            tokensForFetcher,
            sharedPrices,
          )
          const analysis = analyzeSource(source, sourcePrices, ydaemonPrices, outputDir)
          summaryReport.sources[source] = analysis
          const end = Date.now()
          const duration = end - start
          const endIso = new Date().toISOString()
          summaryReport.durations_ms![source] = duration
          if (duration > 5000) {
            summaryReport.slow_sources_ms!.push({ source, duration_ms: duration })
            logger.warn(`[${endIso}] Done source: ${source} in ${duration}ms (SLOW)`)
          } else {
            logger.info(`[${endIso}] Done source: ${source} in ${duration}ms`)
          }
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
      },
      PARALLELISM,
    )

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
        const dur = summaryReport.durations_ms?.[source]
        if (typeof dur === 'number') {
          console.log(`  Duration: ${dur}ms${dur > 5000 ? ' (SLOW)' : ''}`)
        }
      })

    process.exit(0)
  } catch (error) {
    logger.error('Analysis failed:', error)
    process.exit(1)
  }
}

// Run the analysis
analyzeSources()
