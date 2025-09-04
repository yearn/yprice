export * from './curveAmm'
export * from './curveFactories'
export * from './defillama'
export * from './erc4626'
export * from './gamma'
export * from './lensOracle'
export * from './pendle'
export * from './velodrome'
export * from './yearnVault'

import { CurveAmmFetcher } from 'fetchers/curveAmm'
import { CurveFactoriesFetcher } from 'fetchers/curveFactories'
import { DefilllamaFetcher } from 'fetchers/defillama'
import { ERC4626Fetcher } from 'fetchers/erc4626'
import { GammaFetcher } from 'fetchers/gamma'
import { PendleFetcher } from 'fetchers/pendle'
import { VelodromeFetcher } from 'fetchers/velodrome'
import { YearnVaultFetcher } from 'fetchers/yearnVault'
import { ERC20Token, Price } from 'models/index'
import { logger } from 'utils/index'
import { priceCache } from 'utils/priceCache'
import { progressTracker } from 'utils/progressTracker'
import { DISCOVERY_CONFIGS } from 'discovery/config'
import type { PriceFetcher } from 'discovery/types'

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
    const shouldRunFetcher = (fetcher: PriceFetcher): boolean => {
      if (supportedFetchers.length === 0) return true
      return supportedFetchers.includes(fetcher)
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

    // DeFiLlama - primary price source
    if (shouldRunFetcher('defillama')) {
      independentFetchers.push(
        this.defillama
          .fetchPrices(chainId, missingTokens)
          .then((results) => {
            const filtered = new Map()
            results.forEach((price, address) => {
              if (!skipDefillamaAddresses.has(address)) {
                filtered.set(address, price)
              }
            })
            return filtered
          })
          .catch(handleError),
      )
    }

    // Other API-based fetchers
    if (shouldRunFetcher('curve-factories')) {
      independentFetchers.push(
        this.curveFactories.fetchPrices(chainId, missingTokens).catch(handleError),
      )
    }

    if (shouldRunFetcher('gamma')) {
      independentFetchers.push(this.gamma.fetchPrices(chainId, missingTokens).catch(handleError))
    }

    if (shouldRunFetcher('pendle')) {
      independentFetchers.push(this.pendle.fetchPrices(chainId, missingTokens).catch(handleError))
    }

    if (shouldRunFetcher('velodrome')) {
      independentFetchers.push(
        this.velodrome.fetchPrices(chainId, missingTokens, new Map()).catch(handleError),
      )
    }

    // Run all independent fetchers concurrently
    const results = await Promise.allSettled(independentFetchers)

    // Process results and update price map
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        result.value.forEach((price, address) => {
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
        result.value.forEach((price, address) => {
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
}

export default new PriceFetcherOrchestrator()
