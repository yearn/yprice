export * from './services/curveAmm'
export * from './services/curveFactories'
export * from './services/defillama'
export * from './services/erc4626'
export * from './services/gamma'
export * from './services/lensOracle'
export * from './services/pendle'
export * from './services/velodrome'
export * from './services/yearnVault'

import { DISCOVERY_CONFIGS } from 'discovery/config'
import type { PriceFetcher } from 'discovery/types'
import { CurveAmmFetcher } from 'fetchers/services/curveAmm'
import { CurveFactoriesFetcher } from 'fetchers/services/curveFactories'
import { DefilllamaFetcher } from 'fetchers/services/defillama'
import { ERC4626Fetcher } from 'fetchers/services/erc4626'
import { GammaFetcher } from 'fetchers/services/gamma'
import { PendleFetcher } from 'fetchers/services/pendle'
import { VelodromeFetcher } from 'fetchers/services/velodrome'
import { YearnVaultFetcher } from 'fetchers/services/yearnVault'
import { ERC20Token, Price } from 'models/index'
import { logger } from 'utils/index'
import { priceCache } from 'utils/priceCache'
import { progressTracker } from 'utils/progressTracker'

export class PriceFetcherOrchestrator {
  private defillama = new DefilllamaFetcher()
  private curveFactories = new CurveFactoriesFetcher()
  private velodrome = new VelodromeFetcher()
  private gamma = new GammaFetcher()
  private pendle = new PendleFetcher()
  private curveAmm = new CurveAmmFetcher()
  // private lensOracle = new LensOracleFetcher()
  private erc4626 = new ERC4626Fetcher()
  private yearnVault = new YearnVaultFetcher()
  private fetcherFilter?: string

  async fetchPrices(
    chainId: number,
    tokens: ERC20Token[],
    existingPrices?: Map<string, Price>,
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>()
    const progressKey = `fetch-${chainId}-${Date.now()}`

    progressTracker.start(progressKey, 'Price Fetching', tokens.length, chainId)

    // Get supported price fetchers for this chain
    const config = DISCOVERY_CONFIGS[chainId]
    const supportedFetchers = config?.supportedPriceFetchers || []

    // If no supported fetchers configured, use default behavior
    const shouldRunFetcher = (fetcher: PriceFetcher | string): boolean => {
      // If a fetcher filter is set, only run that fetcher
      if (this.fetcherFilter) {
        return fetcher === this.fetcherFilter
      }
      if (supportedFetchers.length === 0) return true
      return supportedFetchers.includes(fetcher as PriceFetcher)
    }

    // Initialize with existing prices if provided
    if (existingPrices) {
      existingPrices.forEach((price, address) => {
        priceMap.set(address, price)
      })
    }

    const symbolMap = new Map<string, string>()
    tokens.forEach((t) => {
      symbolMap.set(t.address.toLowerCase(), t.symbol)
    })

    // Cache check
    const cachedPrices = priceCache.getMany(
      chainId,
      tokens.map((t) => t.address),
    )
    cachedPrices.forEach((price, address) => {
      priceMap.set(address, price)
    })

    progressTracker.update(
      progressKey,
      priceMap.size,
      `${cachedPrices.size} from cache${existingPrices ? ` + ${existingPrices.size} existing` : ''}`,
    )

    let missingTokens = tokens.filter((t) => !priceMap.has(t.address.toLowerCase()))

    if (missingTokens.length === 0) {
      progressTracker.complete(progressKey)
      return priceMap
    }

    const handleError = (error: any) => {
      logger.debug(`Fetcher error: ${error.message || 'Unknown error'}`)
      return new Map<string, Price>()
    }

    // Smart routing: separate tokens by source hint
    const tokensBySource = this.routeTokensBySource(missingTokens)

    // Log routing stats for debugging
    if (tokensBySource.withSource.size > 0) {
      logger.debug(
        `Smart routing: ${tokensBySource.noSource.length} tokens without source, ${Array.from(
          tokensBySource.withSource.entries(),
        )
          .map(([src, tkns]) => `${tkns.length} ${src}`)
          .join(', ')}`,
      )
    }

    // Run all independent fetchers in parallel
    progressTracker.update(progressKey, priceMap.size, 'Fetching prices from all sources...')

    // Known incorrect prices to skip from DeFiLlama
    const skipDefillamaAddresses = new Set(
      [
        chainId === 1 ? '0x27b5739e22ad9033bcbf192059122d163b60349d' : '', // st-yCRV
        chainId === 1 ? '0x69833361991ed76f9e8dbbcdf9ea1520febfb4a7' : '', // st-ETH
      ].filter(Boolean),
    )

    // All price fetchers that don't depend on other prices
    const independentFetchers = []

    // DeFiLlama - primary price source (skip for tokens with specific sources that don't need it)
    const shouldSkipDefillama = (token: ERC20Token): boolean => {
      const vaultSources = ['yearn-vault', 'erc4626', 'vault']
      return vaultSources.some((vs) => token.source?.includes(vs))
    }
    const defillamaTokens = missingTokens.filter((t) => !shouldSkipDefillama(t))

    if (shouldRunFetcher('defillama') && defillamaTokens.length > 0) {
      independentFetchers.push(
        this.defillama
          .fetchPrices(chainId, defillamaTokens)
          .then((results: Map<string, Price>) => {
            const filtered = new Map<string, Price>()
            results.forEach((price: Price, address: string) => {
              if (!skipDefillamaAddresses.has(address)) {
                filtered.set(address, price)
              }
            })
            return filtered
          })
          .catch(handleError),
      )
    }

    // Other API-based fetchers - only run if we have tokens that might match
    const hasCurveTokens = missingTokens.some(
      (t) =>
        t.source?.includes('curve') ||
        t.symbol?.toLowerCase().includes('crv') ||
        t.name?.toLowerCase().includes('curve'),
    )
    if (shouldRunFetcher('curve-factories') && hasCurveTokens) {
      independentFetchers.push(
        this.curveFactories.fetchPrices(chainId, missingTokens).catch(handleError),
      )
    }

    const hasGammaTokens = missingTokens.some(
      (t) => t.source?.includes('gamma') || t.symbol?.toLowerCase().includes('gamma'),
    )
    if (shouldRunFetcher('gamma') && hasGammaTokens) {
      independentFetchers.push(this.gamma.fetchPrices(chainId, missingTokens).catch(handleError))
    }

    const hasPendleTokens = missingTokens.some(
      (t) => t.source?.includes('pendle') || t.symbol?.toLowerCase().includes('pendle'),
    )
    if (shouldRunFetcher('pendle') && hasPendleTokens) {
      independentFetchers.push(this.pendle.fetchPrices(chainId, missingTokens).catch(handleError))
    }

    const hasVeloTokens = missingTokens.some(
      (t) =>
        t.source?.includes('velodrome') ||
        t.source?.includes('aerodrome') ||
        chainId === 10 ||
        chainId === 8453,
    )
    if (shouldRunFetcher('velodrome') && hasVeloTokens) {
      independentFetchers.push(
        this.velodrome.fetchPrices(chainId, missingTokens, new Map()).catch(handleError),
      )
    }

    // Run all independent fetchers concurrently
    const results = await Promise.allSettled(independentFetchers)

    // Process results and update price map
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        result.value.forEach((price: Price, address: string) => {
          if (price.price > BigInt(0) && !priceMap.has(address)) {
            priceMap.set(address, price)
            priceCache.set(chainId, address, price, symbolMap.get(address))
          }
        })
      }
    })

    progressTracker.update(progressKey, priceMap.size, 'Independent fetchers complete')

    missingTokens = tokens.filter((t) => !priceMap.has(t.address.toLowerCase()))
    if (missingTokens.length === 0) {
      progressTracker.complete(progressKey)
      return priceMap
    }

    // Dependent fetchers (need existing prices)
    progressTracker.update(progressKey, priceMap.size, 'Running dependent fetchers...')

    const dependentFetchers = []

    // CurveAmm needs priceMap for LP calculations
    if (shouldRunFetcher('curve-amm')) {
      dependentFetchers.push(
        this.curveAmm.fetchPrices(chainId, missingTokens, priceMap).catch(handleError),
      )
    }

    // Vault fetchers need underlying token prices
    if (shouldRunFetcher('erc4626')) {
      dependentFetchers.push(
        this.erc4626.fetchPrices(chainId, missingTokens, priceMap).catch(handleError),
      )
    }

    if (shouldRunFetcher('yearn-vault')) {
      dependentFetchers.push(
        this.yearnVault.fetchPrices(chainId, missingTokens, priceMap).catch(handleError),
      )
    }

    // If Velodrome needs existing prices and wasn't run in independent phase
    if (
      shouldRunFetcher('velodrome') &&
      priceMap.size > 0 &&
      !independentFetchers.some((f) => f.toString().includes('velodrome'))
    ) {
      dependentFetchers.push(
        this.velodrome.fetchPrices(chainId, missingTokens, priceMap).catch(handleError),
      )
    }

    const dependentResults = await Promise.allSettled(dependentFetchers)

    // Process dependent results
    dependentResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        result.value.forEach((price: Price, address: string) => {
          if (price.price > BigInt(0) && !priceMap.has(address)) {
            priceMap.set(address, price)
            priceCache.set(chainId, address, price, symbolMap.get(address))
          }
        })
      }
    })

    progressTracker.complete(progressKey)

    const finalMissing = tokens.filter((t) => !priceMap.has(t.address.toLowerCase()))
    if (finalMissing.length > 0) {
      logger.debug(`Missing prices for ${finalMissing.length} tokens on chain ${chainId}`)
    }

    return priceMap
  }

  /**
   * Route tokens by source hint to optimize fetcher selection
   * Inspired by ypricemagic's early exit pattern
   */
  private routeTokensBySource(tokens: ERC20Token[]): {
    withSource: Map<string, ERC20Token[]>
    noSource: ERC20Token[]
  } {
    const withSource = new Map<string, ERC20Token[]>()
    const noSource: ERC20Token[] = []

    tokens.forEach((token) => {
      if (token.source) {
        const existing = withSource.get(token.source) || []
        existing.push(token)
        withSource.set(token.source, existing)
      } else {
        noSource.push(token)
      }
    })

    return { withSource, noSource }
  }

  setFetcherFilter(fetcherName: string): void {
    this.fetcherFilter = fetcherName
  }
}

export default new PriceFetcherOrchestrator()
