import dotenv from 'dotenv'
// Ephemeral analyzer: no storage imports
import { logger } from 'utils/index'
import { SUPPORTED_CHAINS } from 'models/types'
import { chainDiscoveryServices, chainFetchers } from 'discovery/config'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
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
  missing_tokens: string[]
  extra_tokens: string[]
}

interface CompleteComparison {
  our_total_unique_tokens: number
  ydaemon_total_tokens: number
  tokens_we_have_ydaemon_doesnt: number
  tokens_ydaemon_has_we_dont: number
  tokens_in_both: number
  accurate_matches: number
  accuracy_pct: number
  our_coverage_of_ydaemon: number
  ydaemon_coverage_of_ours: number
}

interface SummaryReport {
  chain: number
  timestamp: string
  ydaemon_total_tokens: number
  sources: Record<string, SourceAnalysis>
  durations_ms?: Record<string, number>
  slow_sources_ms?: { source: string; duration_ms: number }[]
  complete_comparison?: CompleteComparison
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

  const extraTokens = Array.from(sourceAddresses).filter((addr) => !ydaemonAddresses.has(addr))

  return {
    tokens_found: tokensFound,
    coverage_pct: parseFloat(coveragePct.toFixed(2)),
    accurate_prices: accurateCount,
    accuracy_pct: parseFloat(accuracyPct.toFixed(2)),
    missing_tokens: missingTokens,
    extra_tokens: extraTokens,
  }
}

// Map price fetchers to their required discovery services
const DISCOVERY_DEPENDENCIES: Record<string, string> = {
  'yearn-vault': 'yearn',
  // Add other dependencies as needed in the future
}

async function analyzeSources() {
  try {
    // Parse command line arguments
    const chainIdArg = process.argv[2]
    const serviceFlag = process.argv[3]

    if (!chainIdArg) {
      console.log('Usage: analyze-sources <chainId> [service]')
      console.log('Examples:')
      console.log('  analyze-sources 1          # Run all sources for chain 1')
      console.log('  analyze-sources 1 yearn    # Run only yearn source for chain 1')
      console.log('  analyze-sources 1 defillama # Run only defillama source for chain 1')
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
    const serviceSuffix = serviceFlag ? `-${serviceFlag.toLowerCase()}` : ''
    const outputDir = `output/analyze-sources-${chainId}${serviceSuffix}-${timestamp}`
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    // Fetch baseline prices from ydaemon
    const ydaemonPrices = await fetchYdaemonPrices(chainId)

    // Get all sources for this chain
    const discoveryServices = chainDiscoveryServices[chainId] || []
    const priceFetchers = chainFetchers[chainId] || []
    let allSources = [...discoveryServices, ...priceFetchers]

    // Filter by service if specified
    if (serviceFlag) {
      const requestedService = serviceFlag.toLowerCase()
      const availableServices = new Set(allSources)

      if (!availableServices.has(requestedService)) {
        logger.error(`Service '${serviceFlag}' is not available for chain ${chainId}`)
        logger.info(`Available services for chain ${chainId}:`)
        allSources.forEach(service => logger.info(`  - ${service}`))
        process.exit(1)
      }

      allSources = [requestedService]
      logger.info(`Analyzing single source '${requestedService}' for chain ${chainId}`)
    } else {
      logger.info(`Analyzing ${allSources.length} sources for chain ${chainId}`)
    }

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

    // Check if we need to run a discovery service for a single price fetcher
    if (serviceFlag && DISCOVERY_DEPENDENCIES[serviceFlag]) {
      const requiredDiscovery = DISCOVERY_DEPENDENCIES[serviceFlag]
      const availableDiscoveryServices = chainDiscoveryServices[chainId] || []

      if (availableDiscoveryServices.includes(requiredDiscovery)) {
        logger.info(`\n📊 Running required discovery service '${requiredDiscovery}' for '${serviceFlag}'...`)
        try {
          // First get baseline tokens from tokenlist
          const tokenlistTokens = await tokenDiscoveryService.discoverTokensForService(
            chainId,
            'tokenlist',
          )
          baselineTokens = tokenlistTokens.get(chainId) || []

          // Then run the required discovery service
          const discoveredTokens = await tokenDiscoveryService.discoverTokensForService(
            chainId,
            requiredDiscovery,
          )
          const serviceTokens = discoveredTokens.get(chainId) || []

          // Deduplicate tokens (service tokens take precedence)
          const tokenMap = new Map<string, ERC20Token>()
          baselineTokens.forEach(token => tokenMap.set(token.address.toLowerCase(), token))
          serviceTokens.forEach(token => tokenMap.set(token.address.toLowerCase(), token))
          baselineTokens = Array.from(tokenMap.values())

          logger.info(`Discovered ${serviceTokens.length} tokens from ${requiredDiscovery}, total: ${baselineTokens.length} tokens`)

          // For yearn-vault, we also need to fetch prices for underlying tokens first
          if (serviceFlag === 'yearn-vault') {
            logger.info(`\n💰 Pre-fetching prices for underlying tokens using defillama...`)
            const fetcher = new PriceFetcherOrchestrator()
            fetcher.setFetcherFilter('defillama')
            const underlyingPrices = await fetcher.fetchPrices(chainId, baselineTokens, sharedPrices)
            logger.info(`Pre-fetched ${underlyingPrices.size} prices for underlying tokens`)
          }
        } catch (error) {
          logger.warn(`Failed to run discovery service ${requiredDiscovery}: ${error}`)
        }
      }
    } else if (priceFetchers.length > 0) {
      logger.info(`\n📊 Pre-discovering tokens for chain ${chainId} to use with price fetchers...`)
      try {
        // Start with tokenlist baseline
        const tokensByChain = await tokenDiscoveryService.discoverTokensForService(
          chainId,
          'tokenlist',
        )
        baselineTokens = tokensByChain.get(chainId) || []
        logger.info(`Discovered ${baselineTokens.length} baseline tokens from tokenlist`)

        // Run discovery dependencies for all price fetchers that need them
        const availableDiscoveryServices = chainDiscoveryServices[chainId] || []
        const discoveryServicesToRun = new Set<string>()

        for (const fetcher of priceFetchers) {
          const requiredDiscovery = DISCOVERY_DEPENDENCIES[fetcher]
          if (requiredDiscovery && availableDiscoveryServices.includes(requiredDiscovery)) {
            discoveryServicesToRun.add(requiredDiscovery)
          }
        }

        // Run each required discovery service and merge tokens
        for (const discoveryService of discoveryServicesToRun) {
          logger.info(`Running discovery dependency '${discoveryService}'...`)
          const discoveredTokens = await tokenDiscoveryService.discoverTokensForService(
            chainId,
            discoveryService,
          )
          const serviceTokens = discoveredTokens.get(chainId) || []

          // Deduplicate tokens (service tokens take precedence)
          const tokenMap = new Map<string, ERC20Token>()
          baselineTokens.forEach(token => tokenMap.set(token.address.toLowerCase(), token))
          serviceTokens.forEach(token => tokenMap.set(token.address.toLowerCase(), token))
          baselineTokens = Array.from(tokenMap.values())

          logger.info(`Added ${serviceTokens.length} tokens from ${discoveryService}, total: ${baselineTokens.length} tokens`)
        }

        // Pre-fetch underlying prices for yearn-vault if it's in the sources
        if (priceFetchers.includes('yearn-vault') && discoveryServicesToRun.has('yearn')) {
          logger.info(`\n💰 Pre-fetching prices for underlying tokens using defillama...`)
          const fetcher = new PriceFetcherOrchestrator()
          fetcher.setFetcherFilter('defillama')
          const underlyingPrices = await fetcher.fetchPrices(chainId, baselineTokens, sharedPrices)
          logger.info(`Pre-fetched ${underlyingPrices.size} prices for underlying tokens`)
        }
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
            missing_tokens: [],
            extra_tokens: [],
          }
        }
      },
      PARALLELISM,
    )

    // Aggregate all unique tokens discovered across all sources
    logger.info('\n🔄 Aggregating all discovered tokens for complete comparison...')
    const allDiscoveredPrices = new Map<string, { price: number, sources: string[] }>()
    let missingTokenInfo = new Map<string, { name: string; symbol: string }>()

    // Collect all prices from all sources
    Object.entries(summaryReport.sources).forEach(([sourceName, analysis]) => {
      if (sourceName === 'defillama') return // Skip defillama as it's just the pre-warm

      // Read the CSV file for this source to get actual prices
      try {
        const csvPath = path.join(outputDir, `${sourceName}.csv`)
        if (existsSync(csvPath)) {
          const csvContent = readFileSync(csvPath, 'utf-8')
          const lines = csvContent.split('\n').slice(1) // Skip header

          lines.forEach(line => {
            if (!line.trim()) return
            const parts = line.split(',')
            const address = parts[0]?.replace(/"/g, '').toLowerCase()
            const sourcePrice = parts[1]?.replace(/"/g, '')

            if (address && sourcePrice && sourcePrice !== '') {
              const price = parseFloat(sourcePrice)
              if (!isNaN(price) && price > 0) {
                const existing = allDiscoveredPrices.get(address)
                if (existing) {
                  existing.sources.push(sourceName)
                } else {
                  allDiscoveredPrices.set(address, { price, sources: [sourceName] })
                }
              }
            }
          })
        }
      } catch (error) {
        logger.debug(`Could not read CSV for ${sourceName}: ${error}`)
      }
    })

    // Complete comparison: Our aggregate vs ydaemon
    const completeComparison = {
      our_total_unique_tokens: allDiscoveredPrices.size,
      ydaemon_total_tokens: ydaemonPrices.size,
      tokens_we_have_ydaemon_doesnt: 0,
      tokens_ydaemon_has_we_dont: 0,
      tokens_in_both: 0,
      accurate_matches: 0,
      accuracy_pct: 0,
      our_coverage_of_ydaemon: 0,
      ydaemon_coverage_of_ours: 0,
    }

    // Count overlaps
    allDiscoveredPrices.forEach((data, address) => {
      if (ydaemonPrices.has(address)) {
        completeComparison.tokens_in_both++
        const ydaemonPrice = ydaemonPrices.get(address)!
        const diffPct = calculatePriceDifference(data.price, ydaemonPrice)
        if (diffPct <= 5) {
          completeComparison.accurate_matches++
        }
      } else {
        completeComparison.tokens_we_have_ydaemon_doesnt++
      }
    })

    ydaemonPrices.forEach((_, address) => {
      if (!allDiscoveredPrices.has(address)) {
        completeComparison.tokens_ydaemon_has_we_dont++
      }
    })

    completeComparison.accuracy_pct = completeComparison.tokens_in_both > 0
      ? parseFloat(((completeComparison.accurate_matches / completeComparison.tokens_in_both) * 100).toFixed(2))
      : 0

    completeComparison.our_coverage_of_ydaemon = parseFloat(
      ((completeComparison.tokens_in_both / ydaemonPrices.size) * 100).toFixed(2)
    )

    completeComparison.ydaemon_coverage_of_ours = allDiscoveredPrices.size > 0
      ? parseFloat(((completeComparison.tokens_in_both / allDiscoveredPrices.size) * 100).toFixed(2))
      : 0

    // Add complete comparison to summary report
    summaryReport.complete_comparison = completeComparison

    // Fetch names for tokens we're missing from ydaemon
    logger.info('\n🔍 Fetching names for tokens we are missing from ydaemon...')
    const missingTokenAddresses: string[] = []

    ydaemonPrices.forEach((_, address) => {
      if (!allDiscoveredPrices.has(address)) {
        missingTokenAddresses.push(address)
      }
    })

    // Batch fetch token names and symbols using multicall
    if (missingTokenAddresses.length > 0) {
      try {
        const { batchReadContracts } = await import('utils/viemClients')
        const nameSymbolContracts = missingTokenAddresses.flatMap((address) => [
          {
            address: address as `0x${string}`,
            abi: [{ name: 'name', type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' }],
            functionName: 'name' as const,
            args: [],
          },
          {
            address: address as `0x${string}`,
            abi: [{ name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' }],
            functionName: 'symbol' as const,
            args: [],
          },
        ])

        // Process in chunks to avoid overwhelming the RPC
        const chunkSize = 500
        for (let i = 0; i < nameSymbolContracts.length; i += chunkSize * 2) {
          const chunk = nameSymbolContracts.slice(i, i + chunkSize * 2)
          const results = await batchReadContracts(chainId, chunk)

          // Process results (each token has 2 results: name and symbol)
          for (let j = 0; j < chunk.length; j += 2) {
            const addressIndex = (i + j) / 2
            const address = missingTokenAddresses[addressIndex]
            if (address) {
              const nameResult = results[j]
              const symbolResult = results[j + 1]

              const name = nameResult?.status === 'success' && nameResult.result ? String(nameResult.result) : ''
              const symbol = symbolResult?.status === 'success' && symbolResult.result ? String(symbolResult.result) : ''

              if (name || symbol) {
                missingTokenInfo.set(address.toLowerCase(), { name, symbol })
              }
            }
          }
        }

        logger.info(`Fetched names for ${missingTokenInfo.size} out of ${missingTokenAddresses.length} missing tokens`)
      } catch (error) {
        logger.warn(`Could not fetch token names: ${error}`)
      }
    }

    // Save complete comparison CSV with token names
    const comparisonCsvRows: string[] = [
      'address,token_name,token_symbol,our_price_usd,ydaemon_price_usd,price_diff_pct,sources,status'
    ]

    // Add all our tokens
    allDiscoveredPrices.forEach((data, address) => {
      const ydaemonPrice = ydaemonPrices.get(address)
      if (ydaemonPrice) {
        const diffPct = calculatePriceDifference(data.price, ydaemonPrice)
        comparisonCsvRows.push(
          `"${address}","","","${data.price.toFixed(6)}","${ydaemonPrice.toFixed(6)}","${diffPct.toFixed(2)}","${data.sources.join(';')}","both"`
        )
      } else {
        comparisonCsvRows.push(
          `"${address}","","","${data.price.toFixed(6)}","","","${data.sources.join(';')}","only_ours"`
        )
      }
    })

    // Add ydaemon-only tokens with their names
    ydaemonPrices.forEach((price, address) => {
      if (!allDiscoveredPrices.has(address)) {
        const tokenInfo = missingTokenInfo.get(address.toLowerCase())
        const name = tokenInfo?.name || ''
        const symbol = tokenInfo?.symbol || ''
        comparisonCsvRows.push(
          `"${address}","${name}","${symbol}","","${price.toFixed(6)}","","","only_ydaemon"`
        )
      }
    })

    const comparisonCsvPath = path.join(outputDir, 'complete-comparison.csv')
    writeFileSync(comparisonCsvPath, comparisonCsvRows.join('\n'))
    logger.info(`Saved complete comparison to ${comparisonCsvPath}`)

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
        const dur = summaryReport.durations_ms?.[source]
        if (typeof dur === 'number') {
          console.log(`  Duration: ${dur}ms${dur > 5000 ? ' (SLOW)' : ''}`)
        }
      })

    // Print complete comparison
    if (summaryReport.complete_comparison) {
      console.log('\n' + '='.repeat(60))
      console.log('📊 COMPLETE COMPARISON: All Our Sources vs Ydaemon')
      console.log('='.repeat(60))

      const comp = summaryReport.complete_comparison
      console.log('\n🔢 Token Counts:')
      console.log(`  Our Total Unique Tokens: ${comp.our_total_unique_tokens}`)
      console.log(`  Ydaemon Total Tokens: ${comp.ydaemon_total_tokens}`)

      console.log('\n🔄 Coverage Analysis:')
      console.log(`  Tokens in Both: ${comp.tokens_in_both}`)
      console.log(`  Tokens We Have That Ydaemon Doesn't: ${comp.tokens_we_have_ydaemon_doesnt}`)
      console.log(`  Tokens Ydaemon Has That We Don't: ${comp.tokens_ydaemon_has_we_dont}`)

      console.log('\n📈 Coverage Metrics:')
      console.log(`  Our Coverage of Ydaemon: ${comp.our_coverage_of_ydaemon}% (${comp.tokens_in_both}/${comp.ydaemon_total_tokens})`)
      console.log(`  Ydaemon Coverage of Ours: ${comp.ydaemon_coverage_of_ours}% (${comp.tokens_in_both}/${comp.our_total_unique_tokens})`)

      console.log('\n✅ Accuracy:')
      console.log(`  Accurate Matches: ${comp.accurate_matches}/${comp.tokens_in_both} (${comp.accuracy_pct}% within 5% price difference)`)

      // Analyze missing token types if we fetched their names
      const missingTokenTypes = new Map<string, number>()
      ydaemonPrices.forEach((_, address) => {
        if (!allDiscoveredPrices.has(address)) {
          const tokenInfo = missingTokenInfo.get(address.toLowerCase())
          if (tokenInfo?.symbol) {
            // Categorize by common patterns in symbols
            let category = 'Other'
            const symbol = tokenInfo.symbol.toUpperCase()

            if (symbol.includes('LP') || symbol.includes('-')) {
              category = 'LP/Pool Tokens'
            } else if (symbol.startsWith('YV') || symbol.includes('VAULT')) {
              category = 'Vault Tokens'
            } else if (symbol.startsWith('A') || symbol.startsWith('C') || symbol.includes('DEBT')) {
              category = 'Lending Tokens'
            } else if (symbol.startsWith('W') && symbol !== 'WETH' && symbol !== 'WBTC') {
              category = 'Wrapped Tokens'
            } else if (symbol.includes('USD') || symbol.includes('DAI') || symbol.includes('USDT') || symbol.includes('USDC')) {
              category = 'Stablecoins'
            } else if (tokenInfo.name?.toLowerCase().includes('curve') || symbol.includes('CRV')) {
              category = 'Curve Related'
            } else if (tokenInfo.name?.toLowerCase().includes('uniswap') || symbol.includes('UNI')) {
              category = 'Uniswap Related'
            }

            missingTokenTypes.set(category, (missingTokenTypes.get(category) || 0) + 1)
          }
        }
      })

      if (missingTokenTypes.size > 0) {
        console.log('\n🔍 Missing Token Categories (from ' + missingTokenInfo.size + ' identified):')
        const sortedCategories = Array.from(missingTokenTypes.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)

        sortedCategories.forEach(([category, count]) => {
          console.log(`  ${category}: ${count} tokens`)
        })
      }

      console.log('\n📁 Complete comparison saved to: complete-comparison.csv')
      console.log('    (includes token names/symbols for missing tokens)')
      console.log('='.repeat(60))
    }

    process.exit(0)
  } catch (error) {
    logger.error('Analysis failed:', error)
    process.exit(1)
  }
}

// Run the analysis
analyzeSources()
