import { DISCOVERY_CONFIGS } from 'discovery/config'
import { DISCOVERY_REGISTRY } from 'discovery/registry'
import { TokenInfo } from 'discovery/types'
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
          )
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
      const rpcUrl = this.getRpcUrl(chainId)
      const expectedSources = config
        ? DISCOVERY_REGISTRY.filter((e) => e.create(chainId, config, rpcUrl) !== null).length
        : 0

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

  async discoverTokensForService(
    chainId: number,
    serviceName: string,
  ): Promise<Map<number, ERC20Token[]>> {
    logger.info(`🔍 Starting token discovery for chain ${chainId} with service ${serviceName}...`)
    this.discoveredTokens.clear()

    const config = DISCOVERY_CONFIGS[chainId]
    if (!config) {
      logger.error(`No configuration found for chain ${chainId}`)
      return new Map()
    }

    try {
      await this.discoverChainTokens(chainId, config, serviceName)
    } catch (error) {
      logger.error(`Chain ${chainId} discovery with service ${serviceName} failed:`, error)
      // Ensure at least base tokens are available
      if (config.baseTokens && config.baseTokens.length > 0) {
        const baseTokens: TokenInfo[] = config.baseTokens.map((address) => ({
          address: address.toLowerCase(),
          chainId,
          source: 'configured',
        }))
        this.discoveredTokens.set(chainId, baseTokens)
      }
    }

    // Convert discovered tokens to ERC20Token format
    const result = new Map<number, ERC20Token[]>()
    const tokens = this.discoveredTokens.get(chainId)

    if (tokens) {
      const erc20Tokens = this.convertToERC20Tokens(chainId, tokens)
      result.set(chainId, erc20Tokens)
      logger.info(
        `✅ Discovery complete: ${erc20Tokens.length} tokens found for chain ${chainId} with ${serviceName}`,
      )
    }

    return result
  }

  private async discoverChainTokens(
    chainId: number,
    config: any,
    serviceFilter?: string,
  ): Promise<void> {
    const startTime = Date.now()

    try {
      const rpcUrl = this.getRpcUrl(chainId)

      if (!rpcUrl) {
        logger.debug(
          `Chain ${chainId}: No RPC URL configured (RPC_URI_FOR_${chainId}). On-chain discoveries will be skipped.`,
        )
      }

      const withTimeout = async <T>(
        promise: Promise<T>,
        timeoutMs: number,
        source: string,
      ): Promise<T | null> => {
        try {
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

      const discoveryPromises: Promise<TokenInfo[] | null>[] = []
      const sourceNames: string[] = []
      const supportedServices = config.supportedServices || []

      const shouldRunService = (service: string): boolean => {
        if (serviceFilter) return service === serviceFilter
        if (supportedServices.length === 0) return true
        return supportedServices.includes(service as any)
      }

      // Build discovery tasks from registry
      for (const entry of DISCOVERY_REGISTRY) {
        if (!shouldRunService(entry.source)) continue
        const service = entry.create(chainId, config, rpcUrl)
        if (!service) continue

        sourceNames.push(entry.displayName)
        discoveryPromises.push(
          withTimeout(service.discoverTokens(), entry.timeoutMs, entry.displayName),
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

          if (tokens.length > 0) {
            const source = tokens[0]?.source || 'unknown'
            sourceStats[source] = tokens.length
            logger.debug(`Chain ${chainId}: ${sourceName} returned ${tokens.length} tokens`)
          } else {
            logger.debug(`Chain ${chainId}: ${sourceName} returned 0 tokens`)
          }
        } else if (result.status === 'fulfilled' && result.value === null) {
          timeoutCount++
          logger.debug(`Chain ${chainId}: ${sourceName} timed out or returned null`)
        } else if (result.status === 'rejected') {
          const errorMsg = result.reason?.message || result.reason || 'Unknown error'
          failedSources.push(`${sourceName}: ${errorMsg}`)
          logger.error(`Chain ${chainId}: ${sourceName} failed: ${errorMsg}`)
        }
      })

      logger.debug(
        `Chain ${chainId}: Discovery completed - ${successCount}/${discoveryPromises.length} sources succeeded${timeoutCount > 0 ? `, ${timeoutCount} timed out` : ''}`,
      )

      if (Object.keys(sourceStats).length > 0) {
        logger.debug(`Chain ${chainId}: Successful discoveries:`)
        Object.entries(sourceStats).forEach(([source, count]) => {
          if (count > 0) {
            logger.debug(`  ✓ ${source}: ${count} tokens`)
          }
        })
      }

      if (failedSources.length > 0) {
        logger.debug(`Chain ${chainId}: Failed discoveries:`)
        failedSources.forEach((failure) => {
          logger.debug(`  ✗ ${failure}`)
        })
      }

      // CRITICAL: Always add base tokens
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

      logger.debug(`Chain ${chainId}: Total tokens before deduplication: ${allTokens.length}`)

      const uniqueTokens = deduplicateTokens(allTokens)
      this.discoveredTokens.set(chainId, uniqueTokens)

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
}

export default new TokenDiscoveryService()
