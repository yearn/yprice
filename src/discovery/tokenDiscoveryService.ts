import { AAVEDiscovery } from 'discovery/aaveDiscovery'
import { BalancerDiscovery } from 'discovery/balancerDiscovery'
import { CompoundDiscovery } from 'discovery/compoundDiscovery'
import { DISCOVERY_CONFIGS } from 'discovery/config'
import { CurveDiscovery } from 'discovery/curveDiscovery'
import { CurveFactoriesDiscovery } from 'discovery/curveFactories'
import { GammaDiscovery } from 'discovery/gammaDiscovery'
import { GenericVaultDiscovery } from 'discovery/genericVaultDiscovery'
import { PendleDiscovery } from 'discovery/pendleDiscovery'
import tokenListDiscovery from 'discovery/tokenListDiscovery'
import { TokenInfo } from 'discovery/types'
import { UniswapDiscovery } from 'discovery/uniswapDiscovery'
import { VeloDiscovery } from 'discovery/veloDiscovery'
import { YearnDiscovery } from 'discovery/yearnDiscovery'
import { ERC20Token } from 'models/index'
import { deduplicateTokens, logger } from 'utils/index'

export class TokenDiscoveryService {
  private discoveredTokens: Map<number, TokenInfo[]> = new Map()
  private tokenCache: Map<number, ERC20Token[]> = new Map()
  private lastDiscovery: number = 0
  private discoveryInterval: number = 3600000 // 1 hour

  async discoverAllTokens(forceRefresh: boolean = false): Promise<Map<number, ERC20Token[]>> {
    const now = Date.now()

    // Use cache if available and not forcing refresh
    if (!forceRefresh && this.lastDiscovery && now - this.lastDiscovery < this.discoveryInterval) {
      logger.debug('Using cached discovered tokens')
      return this.tokenCache
    }

    logger.info('🔍 Starting token discovery...')
    this.discoveredTokens.clear()
    this.tokenCache.clear()

    // Discover tokens for each chain in parallel with timeout
    const discoveryPromises: Promise<void>[] = []

    for (const [chainId, config] of Object.entries(DISCOVERY_CONFIGS)) {
      const chainDiscoveryWithTimeout = Promise.race([
        this.discoverChainTokens(Number(chainId), config),
        new Promise<void>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Chain ${chainId} discovery timeout after 180s`)),
            180000,
          ) // Increased to 3 minutes
        }),
      ]).catch((error) => {
        logger.error(`Chain ${chainId} discovery failed: ${error.message}`)
        // Ensure at least base tokens are available for the chain
        const config = DISCOVERY_CONFIGS[Number(chainId)]
        if (config?.baseTokens && config.baseTokens.length > 0) {
          const baseTokens: TokenInfo[] = config.baseTokens.map((address) => ({
            address: address.toLowerCase(),
            chainId: Number(chainId),
            source: 'configured',
          }))
          this.discoveredTokens.set(Number(chainId), baseTokens)
        }
      })

      discoveryPromises.push(chainDiscoveryWithTimeout)
    }

    await Promise.all(discoveryPromises)

    // Convert discovered tokens to ERC20Token format
    let totalTokens = 0
    for (const [chainId, tokens] of this.discoveredTokens.entries()) {
      const erc20Tokens = this.convertToERC20Tokens(chainId, tokens)
      this.tokenCache.set(chainId, erc20Tokens)
      totalTokens += erc20Tokens.length
      logger.debug(`Chain ${chainId}: Discovered ${erc20Tokens.length} unique tokens`)
    }

    // Discovery summary
    logger.info(
      `✅ Token discovery complete: ${totalTokens} tokens across ${this.tokenCache.size} chains`,
    )

    // Identify problematic chains at debug level
    const problematicChains: number[] = []
    for (const [chainId, tokens] of this.discoveredTokens.entries()) {
      const config = DISCOVERY_CONFIGS[chainId]
      const expectedSources = this.countExpectedSources(chainId, config)

      // If we got less than 20% of expected tokens, it's problematic
      if (tokens.length < 50 && expectedSources > 3) {
        problematicChains.push(chainId)
      }
    }

    if (problematicChains.length > 0) {
      logger.debug(`⚠️  Chains with potential discovery issues: ${problematicChains.join(', ')}`)
      logger.debug(`   Consider checking RPC URLs and API endpoints for these chains.`)
    }

    this.lastDiscovery = now
    return this.tokenCache
  }

  private async discoverChainTokens(chainId: number, config: any): Promise<void> {
    const startTime = Date.now()

    try {
      // Get RPC URL from environment
      const rpcUrl = this.getRpcUrl(chainId)

      // Warn if no RPC URL is configured for on-chain discoveries
      if (!rpcUrl) {
        const needsRpc =
          config.yearnRegistryAddress ||
          config.aaveV2LendingPool ||
          config.aaveV3Pool ||
          config.compoundComptroller ||
          config.curveFactoryAddress ||
          chainId

        if (needsRpc) {
          logger.debug(
            `Chain ${chainId}: No RPC URL configured (RPC_URI_FOR_${chainId}). On-chain discoveries will be skipped.`,
          )
        }
      }

      // Create timeout wrapper for discovery sources
      const withTimeout = async <T>(
        promise: Promise<T>,
        timeoutMs: number,
        source: string,
      ): Promise<T | null> => {
        try {
          // Create an AbortController for proper cleanup
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

          const result = await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
              controller.signal.addEventListener('abort', () => {
                reject(new Error(`Timeout after ${timeoutMs}ms`))
              })
            }),
          ])

          clearTimeout(timeoutId)
          return result
        } catch (error: any) {
          if (error.message?.includes('Timeout')) {
            logger.debug(`Chain ${chainId}: ${source} discovery timed out after ${timeoutMs}ms`)
          } else {
            logger.debug(`Chain ${chainId}: ${source} discovery failed: ${error.message || error}`)
          }
          return null
        }
      }

      // Prepare all discovery sources
      const discoveryPromises: Promise<TokenInfo[] | null>[] = []
      const sourceNames: string[] = []
      const supportedServices = config.supportedServices || []

      // If no supported services defined, run all services (backward compatibility)
      const shouldRunService = (service: string): boolean => {
        if (supportedServices.length === 0) return true
        return supportedServices.includes(service as any)
      }

      // 1. Yearn vaults (on-chain, needs more time)
      if (shouldRunService('yearn') && (config.yearnRegistryAddress || chainId) && rpcUrl) {
        sourceNames.push('Yearn')
        discoveryPromises.push(
          withTimeout(
            new YearnDiscovery(chainId, rpcUrl).discoverTokens(),
            60000, // 60s for Yearn discovery
            'Yearn',
          ),
        )
      }

      // 2. Curve pools from API (API call, medium timeout)
      if (shouldRunService('curve-api') && (config.curveFactoryAddress || config.curveApiUrl)) {
        sourceNames.push('Curve API')
        discoveryPromises.push(
          withTimeout(
            new CurveDiscovery(
              chainId,
              config.curveFactoryAddress,
              config.curveApiUrl,
              rpcUrl,
            ).discoverTokens(),
            45000, // 45s for API
            'Curve API',
          ),
        )
      }

      // 3. Curve factory pools (heavy on-chain discovery)
      if (shouldRunService('curve-factories') && rpcUrl) {
        sourceNames.push('Curve Factories')
        discoveryPromises.push(
          withTimeout(
            new CurveFactoriesDiscovery(chainId, rpcUrl).discoverTokens(),
            60000, // 60s for heavy on-chain discovery
            'Curve Factories',
          ),
        )
      }

      // 4. Velodrome/Aerodrome pools
      if (shouldRunService('velodrome') && (config.veloSugarAddress || config.veloApiUrl)) {
        sourceNames.push('Velodrome/Aerodrome')
        discoveryPromises.push(
          withTimeout(
            new VeloDiscovery(
              chainId,
              config.veloSugarAddress,
              config.veloApiUrl,
              rpcUrl,
            ).discoverTokens(),
            90000, // Increased to 90s for Velo/Aero due to Base performance issues
            'Velodrome/Aerodrome',
          ),
        )
      }

      // 5. Token lists (API calls, medium timeout)
      if (shouldRunService('tokenlist')) {
        sourceNames.push('Token Lists')
        discoveryPromises.push(
          withTimeout(
            tokenListDiscovery.discoverTokens(chainId).then((tokens) =>
              tokens.map((t: ERC20Token) => ({
                address: t.address,
                chainId: t.chainId,
                source: 'tokenlist',
              })),
            ),
            45000, // 45s for multiple API calls
            'Token Lists',
          ),
        )
      }

      // 6. Gamma Protocol (API call)
      if (shouldRunService('gamma')) {
        sourceNames.push('Gamma')
        discoveryPromises.push(
          withTimeout(
            new GammaDiscovery(chainId).discoverTokens(),
            45000, // 45s for API
            'Gamma',
          ),
        )
      }

      // 7. Pendle (API call)
      if (shouldRunService('pendle')) {
        sourceNames.push('Pendle')
        discoveryPromises.push(
          withTimeout(
            new PendleDiscovery(chainId).discoverTokens(),
            45000, // 45s for API
            'Pendle',
          ),
        )
      }

      // 8. AAVE (on-chain discovery)
      if (shouldRunService('aave') && (config.aaveV2LendingPool || config.aaveV3Pool) && rpcUrl) {
        sourceNames.push('AAVE')
        discoveryPromises.push(
          withTimeout(
            new AAVEDiscovery(
              chainId,
              config.aaveV2LendingPool,
              config.aaveV3Pool,
              rpcUrl,
            ).discoverTokens(),
            60000, // 60s for on-chain
            'AAVE',
          ),
        )
      }

      // 9. Compound (on-chain discovery)
      if (shouldRunService('compound') && config.compoundComptroller && rpcUrl) {
        sourceNames.push('Compound')
        discoveryPromises.push(
          withTimeout(
            new CompoundDiscovery(chainId, config.compoundComptroller, rpcUrl).discoverTokens(),
            60000, // 60s for on-chain
            'Compound',
          ),
        )
      }

      // 10. Uniswap (heavy on-chain discovery)
      if (shouldRunService('uniswap') && rpcUrl) {
        sourceNames.push('Uniswap')
        discoveryPromises.push(
          withTimeout(
            new UniswapDiscovery(chainId).discoverTokens(),
            60000, // 60s for on-chain
            'Uniswap',
          ),
        )
      }

      // 11. Balancer (API call)
      if (shouldRunService('balancer')) {
        sourceNames.push('Balancer')
        discoveryPromises.push(
          withTimeout(
            new BalancerDiscovery(chainId).discoverTokens(),
            45000, // 45s for API
            'Balancer',
          ),
        )
      }

      // 12. Generic Vaults from DefLlama (API call)
      if (shouldRunService('generic-vaults')) {
        sourceNames.push('Generic Vaults')
        discoveryPromises.push(
          withTimeout(
            new GenericVaultDiscovery(chainId).discoverTokens(),
            45000, // 45s for API
            'Generic Vaults',
          ),
        )
      }

      // Execute all discoveries in parallel
      logger.info(`Chain ${chainId}: Starting discovery with ${discoveryPromises.length} sources`)
      logger.debug(`Chain ${chainId}: Discovery sources queued: ${sourceNames.join(', ')}`)

      const results = await Promise.allSettled(discoveryPromises)

      // Collect all discovered tokens and track failures
      const allTokens: TokenInfo[] = []
      const sourceStats: Record<string, number> = {}
      const failedSources: string[] = []
      let successCount = 0
      let timeoutCount = 0

      results.forEach((result, index) => {
        const sourceName = sourceNames[index] || `Source ${index}`

        if (result.status === 'fulfilled' && result.value) {
          const tokens = result.value
          allTokens.push(...tokens)
          successCount++

          // Track source statistics
          if (tokens.length > 0) {
            const source = tokens[0]?.source || 'unknown'
            sourceStats[source] = tokens.length
            logger.debug(`Chain ${chainId}: ${sourceName} returned ${tokens.length} tokens`)
          } else {
            logger.debug(`Chain ${chainId}: ${sourceName} returned 0 tokens`)
          }
        } else if (result.status === 'fulfilled' && result.value === null) {
          // Timeout case
          timeoutCount++
          logger.debug(`Chain ${chainId}: ${sourceName} timed out or returned null`)
        } else if (result.status === 'rejected') {
          // Actual failure
          const errorMsg = result.reason?.message || result.reason || 'Unknown error'
          failedSources.push(`${sourceName}: ${errorMsg}`)
          logger.error(`Chain ${chainId}: ${sourceName} failed: ${errorMsg}`)
        }
      })

      // Log summary at debug level
      logger.debug(
        `Chain ${chainId}: Discovery completed - ${successCount}/${discoveryPromises.length} sources succeeded${timeoutCount > 0 ? `, ${timeoutCount} timed out` : ''}`,
      )

      // Log successful discoveries at debug level
      if (Object.keys(sourceStats).length > 0) {
        logger.debug(`Chain ${chainId}: Successful discoveries:`)
        Object.entries(sourceStats).forEach(([source, count]) => {
          if (count > 0) {
            logger.debug(`  ✓ ${source}: ${count} tokens`)
          }
        })
      }

      // Log failures at debug level
      if (failedSources.length > 0) {
        logger.debug(`Chain ${chainId}: Failed discoveries:`)
        failedSources.forEach((failure) => {
          logger.debug(`  ✗ ${failure}`)
        })
      }

      // CRITICAL: Always add base tokens
      // This ensures major tokens are always present even if discovery fails
      if (config.baseTokens) {
        for (const address of config.baseTokens) {
          allTokens.push({
            address: address.toLowerCase(),
            chainId,
            source: 'configured',
          })
        }
        logger.debug(`Chain ${chainId}: Added ${config.baseTokens.length} base tokens`)
      }

      // Log token counts at debug level
      logger.debug(`Chain ${chainId}: Total tokens before deduplication: ${allTokens.length}`)

      // Deduplicate and store discovered tokens
      const uniqueTokens = deduplicateTokens(allTokens)
      this.discoveredTokens.set(chainId, uniqueTokens)

      // Debug: Check for specific vault
      const TARGET_VAULT = '0x32651dd149a6ec22734882f790cbeb21402663f9'
      const foundInAll = allTokens.find((t) => t.address === TARGET_VAULT)
      const foundInUnique = uniqueTokens.find((t) => t.address === TARGET_VAULT)
      if (foundInAll && !foundInUnique) {
        logger.warn(
          `Chain ${chainId}: Target vault ${TARGET_VAULT} was removed during deduplication`,
        )
      } else if (foundInAll) {
        logger.debug(
          `Chain ${chainId}: Target vault ${TARGET_VAULT} found with source: ${foundInAll.source}`,
        )
      }

      // Log deduplication results at debug level
      if (allTokens.length !== uniqueTokens.length) {
        logger.debug(
          `Chain ${chainId}: Deduplication removed ${allTokens.length - uniqueTokens.length} duplicate tokens`,
        )
      }

      const elapsed = Date.now() - startTime
      logger.info(
        `Chain ${chainId}: Discovery complete in ${elapsed}ms (${uniqueTokens.length} unique tokens)`,
      )
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error)
      logger.error(
        `Token discovery failed for chain ${chainId}: ${(errorMsg || 'Unknown error').substring(0, 100)}`,
      )

      // Even on error, ensure base tokens are available
      const fallbackTokens: TokenInfo[] = (config.baseTokens || []).map((address: string) => ({
        address: address.toLowerCase(),
        chainId,
        source: 'configured',
      }))

      this.discoveredTokens.set(chainId, fallbackTokens)
      logger.info(
        `Chain ${chainId}: Using ${fallbackTokens.length} fallback tokens due to discovery error`,
      )
    }
  }

  private convertToERC20Tokens(chainId: number, tokens: TokenInfo[]): ERC20Token[] {
    const erc20Tokens: ERC20Token[] = []

    for (const token of tokens) {
      erc20Tokens.push({
        address: token.address,
        symbol: token.symbol || 'UNKNOWN',
        name: token.name || 'Unknown Token',
        decimals: token.decimals || 18,
        chainId: chainId,
        source: token.source,
        isVault: token.isVault,
      })
    }

    return erc20Tokens
  }

  private getRpcUrl(chainId: number): string | undefined {
    // Use the existing RPC_URI_FOR_[chainId] pattern from .env
    const envKey = `RPC_URI_FOR_${chainId}`
    return process.env[envKey]
  }

  getTokensForChain(chainId: number): ERC20Token[] {
    return this.tokenCache.get(chainId) || []
  }

  getAllTokens(): Map<number, ERC20Token[]> {
    return this.tokenCache
  }

  getTotalTokenCount(): number {
    let total = 0
    for (const tokens of this.tokenCache.values()) {
      total += tokens.length
    }
    return total
  }

  getChainTokenCounts(): Record<number, number> {
    const counts: Record<number, number> = {}
    for (const [chainId, tokens] of this.tokenCache.entries()) {
      counts[chainId] = tokens.length
    }
    return counts
  }

  private countExpectedSources(chainId: number, config: any): number {
    const rpcUrl = this.getRpcUrl(chainId)
    let count = 0

    // Count expected discovery sources
    if ((config.yearnRegistryAddress || chainId) && rpcUrl) count++
    if (config.curveFactoryAddress || config.curveApiUrl) count++
    if (rpcUrl) count++ // Curve Factories
    if (config.veloSugarAddress || config.veloApiUrl) count++
    count++ // Token Lists (always)
    count++ // Gamma (always)
    count++ // Pendle (always)
    if ((config.aaveV2LendingPool || config.aaveV3Pool) && rpcUrl) count++
    if (config.compoundComptroller && rpcUrl) count++
    if (rpcUrl) count++ // Uniswap
    count++ // Balancer (always)

    return count
  }
}

export default new TokenDiscoveryService()
