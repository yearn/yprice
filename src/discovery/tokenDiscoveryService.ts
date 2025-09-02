import { TokenInfo } from './types';
import { DISCOVERY_CONFIGS } from './config';
import { CurveDiscovery } from './curveDiscovery';
import { CurveFactoriesDiscovery } from './curveFactories';
import { VeloDiscovery } from './veloDiscovery';
import { YearnDiscovery } from './yearnDiscovery';
import tokenListDiscovery from './tokenListDiscovery';
import { GammaDiscovery } from './gammaDiscovery';
import { PendleDiscovery } from './pendleDiscovery';
import { AAVEDiscovery } from './aaveDiscovery';
import { CompoundDiscovery } from './compoundDiscovery';
import { UniswapDiscovery } from './uniswapDiscovery';
import { BalancerDiscovery } from './balancerDiscovery';
import { getCoreTokensForChain } from './coreTokens';
import { ERC20Token } from '../models';
import { logger } from '../utils';

export class TokenDiscoveryService {
  private discoveredTokens: Map<number, TokenInfo[]> = new Map();
  private tokenCache: Map<number, ERC20Token[]> = new Map();
  private lastDiscovery: number = 0;
  private discoveryInterval: number = 3600000; // 1 hour

  async discoverAllTokens(forceRefresh: boolean = false): Promise<Map<number, ERC20Token[]>> {
    const now = Date.now();
    
    // Use cache if available and not forcing refresh
    if (!forceRefresh && this.lastDiscovery && (now - this.lastDiscovery) < this.discoveryInterval) {
      logger.debug('Using cached discovered tokens');
      return this.tokenCache;
    }

    logger.info('🔍 Starting token discovery across all chains...');
    this.discoveredTokens.clear();
    this.tokenCache.clear();

    // Discover tokens for each chain in parallel with timeout
    const discoveryPromises: Promise<void>[] = [];
    
    for (const [chainId, config] of Object.entries(DISCOVERY_CONFIGS)) {
      const chainDiscoveryWithTimeout = Promise.race([
        this.discoverChainTokens(Number(chainId), config),
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error(`Chain ${chainId} discovery timeout after 180s`)), 180000); // Increased to 3 minutes
        })
      ]).catch(error => {
        logger.error(`Chain ${chainId} discovery failed: ${error.message}`);
        // Ensure at least core tokens are available for the chain
        const coreTokens = getCoreTokensForChain(Number(chainId));
        if (coreTokens.length > 0) {
          this.discoveredTokens.set(Number(chainId), coreTokens);
        }
      });
      
      discoveryPromises.push(chainDiscoveryWithTimeout);
    }

    await Promise.all(discoveryPromises);

    // Convert discovered tokens to ERC20Token format
    let totalTokens = 0;
    for (const [chainId, tokens] of this.discoveredTokens.entries()) {
      const erc20Tokens = this.convertToERC20Tokens(chainId, tokens);
      this.tokenCache.set(chainId, erc20Tokens);
      totalTokens += erc20Tokens.length;
      logger.debug(`Chain ${chainId}: Discovered ${erc20Tokens.length} unique tokens`);
    }
    
    // Discovery health check summary
    logger.info(`✅ Token discovery complete: ${totalTokens} tokens across ${this.tokenCache.size} chains`);
    
    // Identify problematic chains
    const problematicChains: number[] = [];
    for (const [chainId, tokens] of this.discoveredTokens.entries()) {
      const config = DISCOVERY_CONFIGS[chainId];
      const expectedSources = this.countExpectedSources(chainId, config);
      
      // If we got less than 20% of expected tokens, it's problematic
      if (tokens.length < 50 && expectedSources > 3) {
        problematicChains.push(chainId);
      }
    }
    
    if (problematicChains.length > 0) {
      logger.warn(`⚠️  Chains with potential discovery issues: ${problematicChains.join(', ')}`);
      logger.warn(`   Consider checking RPC URLs and API endpoints for these chains.`);
    }

    this.lastDiscovery = now;
    return this.tokenCache;
  }

  private async discoverChainTokens(chainId: number, config: any): Promise<void> {
    logger.info(`Chain ${chainId}: Starting discovery...`);
    const startTime = Date.now();
    
    try {
      // Get RPC URL from environment
      const rpcUrl = this.getRpcUrl(chainId);
      
      // Warn if no RPC URL is configured for on-chain discoveries
      if (!rpcUrl) {
        const needsRpc = config.yearnRegistryAddress || config.aaveV2LendingPool || 
                        config.aaveV3Pool || config.compoundComptroller || 
                        config.curveFactoryAddress || chainId;
        
        if (needsRpc) {
          logger.warn(`Chain ${chainId}: No RPC URL configured (RPC_URI_FOR_${chainId}). On-chain discoveries will be skipped.`);
        }
      }

      // Create timeout wrapper for discovery sources
      const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, source: string): Promise<T | null> => {
        try {
          // Create an AbortController for proper cleanup
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
          
          const result = await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
              controller.signal.addEventListener('abort', () => {
                reject(new Error(`Timeout after ${timeoutMs}ms`));
              });
            })
          ]);
          
          clearTimeout(timeoutId);
          return result;
        } catch (error: any) {
          if (error.message?.includes('Timeout')) {
            logger.warn(`Chain ${chainId}: ${source} discovery timed out after ${timeoutMs}ms`);
          } else {
            logger.warn(`Chain ${chainId}: ${source} discovery failed: ${error.message || error}`);
          }
          return null;
        }
      };

      // Prepare all discovery sources
      const discoveryPromises: Promise<TokenInfo[] | null>[] = [];
      const sourceNames: string[] = [];

      // 1. Yearn vaults (on-chain, needs more time)
      if ((config.yearnRegistryAddress || chainId) && rpcUrl) {
        sourceNames.push('Yearn');
        discoveryPromises.push(
          new YearnDiscovery(chainId, rpcUrl).discoverTokens().catch(err => {
            logger.warn(`Chain ${chainId}: Yearn discovery failed: ${err.message}`);
            return null;
          })
        );
      }

      // 2. Curve pools from API (API call, medium timeout)
      if (config.curveFactoryAddress || config.curveApiUrl) {
        sourceNames.push('Curve API');
        discoveryPromises.push(
          withTimeout(
            new CurveDiscovery(
              chainId,
              config.curveFactoryAddress,
              config.curveApiUrl,
              rpcUrl
            ).discoverTokens(),
            45000, // 45s for API
            'Curve API'
          )
        );
      }

      // 3. Curve factory pools (heavy on-chain discovery)
      if (rpcUrl) {
        sourceNames.push('Curve Factories');
        discoveryPromises.push(
          withTimeout(
            new CurveFactoriesDiscovery(chainId, rpcUrl).discoverTokens(),
            60000, // 60s for heavy on-chain discovery
            'Curve Factories'
          )
        );
      }

      // 4. Velodrome/Aerodrome pools
      if (config.veloSugarAddress || config.veloApiUrl) {
        sourceNames.push('Velodrome/Aerodrome');
        discoveryPromises.push(
          withTimeout(
            new VeloDiscovery(
              chainId,
              config.veloSugarAddress,
              config.veloApiUrl,
              rpcUrl
            ).discoverTokens(),
            90000, // Increased to 90s for Velo/Aero due to Base performance issues
            'Velodrome/Aerodrome'
          )
        );
      }

      // 5. Token lists (API calls, medium timeout)
      sourceNames.push('Token Lists');
      discoveryPromises.push(
        withTimeout(
          tokenListDiscovery.discoverTokens(chainId).then(tokens => 
            tokens.map((t: ERC20Token) => ({
              address: t.address,
              chainId: t.chainId,
              source: 'tokenlist',
            }))
          ),
          45000, // 45s for multiple API calls
          'Token Lists'
        )
      );

      // 6. Gamma Protocol (API call)
      sourceNames.push('Gamma');
      discoveryPromises.push(
        withTimeout(
          new GammaDiscovery(chainId).discoverTokens(),
          45000, // 45s for API
          'Gamma'
        )
      );

      // 7. Pendle (API call)
      sourceNames.push('Pendle');
      discoveryPromises.push(
        withTimeout(
          new PendleDiscovery(chainId).discoverTokens(),
          45000, // 45s for API
          'Pendle'
        )
      );

      // 8. AAVE (on-chain discovery)
      if ((config.aaveV2LendingPool || config.aaveV3Pool) && rpcUrl) {
        sourceNames.push('AAVE');
        discoveryPromises.push(
          withTimeout(
            new AAVEDiscovery(
              chainId,
              config.aaveV2LendingPool,
              config.aaveV3Pool,
              rpcUrl
            ).discoverTokens(),
            60000, // 60s for on-chain
            'AAVE'
          )
        );
      }

      // 9. Compound (on-chain discovery)
      if (config.compoundComptroller && rpcUrl) {
        sourceNames.push('Compound');
        discoveryPromises.push(
          withTimeout(
            new CompoundDiscovery(
              chainId,
              config.compoundComptroller,
              rpcUrl
            ).discoverTokens(),
            60000, // 60s for on-chain
            'Compound'
          )
        );
      }

      // 10. Uniswap (heavy on-chain discovery)
      if (rpcUrl) {
        sourceNames.push('Uniswap');
        discoveryPromises.push(
          withTimeout(
            new UniswapDiscovery(chainId).discoverTokens(),
            60000, // 60s for on-chain
            'Uniswap'
          )
        );
      }

      // 11. Balancer (API call)
      sourceNames.push('Balancer');
      discoveryPromises.push(
        withTimeout(
          new BalancerDiscovery(chainId).discoverTokens(),
          45000, // 45s for API
          'Balancer'
        )
      );

      // Execute all discoveries in parallel
      logger.info(`Chain ${chainId}: Running ${discoveryPromises.length} discovery sources in parallel...`);
      logger.debug(`Chain ${chainId}: Discovery sources queued: ${sourceNames.join(', ')}`);
      
      // Add debug logging for promise execution
      const startPromiseTime = Date.now();
      const results = await Promise.allSettled(discoveryPromises);
      logger.debug(`Chain ${chainId}: Promise.allSettled completed in ${Date.now() - startPromiseTime}ms`);
      
      // Collect all discovered tokens and track failures
      const allTokens: TokenInfo[] = [];
      const sourceStats: Record<string, number> = {};
      const failedSources: string[] = [];
      let successCount = 0;
      let timeoutCount = 0;
      
      results.forEach((result, index) => {
        const sourceName = sourceNames[index] || `Source ${index}`;
        
        if (result.status === 'fulfilled' && result.value) {
          const tokens = result.value;
          allTokens.push(...tokens);
          successCount++;
          
          // Track source statistics
          if (tokens.length > 0) {
            const source = tokens[0]?.source || 'unknown';
            sourceStats[source] = tokens.length;
          }
        } else if (result.status === 'fulfilled' && result.value === null) {
          // Timeout case
          timeoutCount++;
        } else if (result.status === 'rejected') {
          // Actual failure
          failedSources.push(`${sourceName}: ${result.reason}`);
        }
      });
      
      // Log summary first
      logger.info(`Chain ${chainId}: Discovery completed - ${successCount}/${discoveryPromises.length} sources succeeded${timeoutCount > 0 ? `, ${timeoutCount} timed out` : ''}`);
      
      // Log successful discoveries
      if (Object.keys(sourceStats).length > 0) {
        logger.info(`Chain ${chainId}: Successful discoveries:`);
        Object.entries(sourceStats).forEach(([source, count]) => {
          if (count > 0) {
            logger.info(`  ✓ ${source}: ${count} tokens`);
          }
        });
      }
      
      // Log failures if any
      if (failedSources.length > 0) {
        logger.warn(`Chain ${chainId}: Failed discoveries:`);
        failedSources.forEach(failure => {
          logger.warn(`  ✗ ${failure}`);
        });
      }

      // CRITICAL: Always add core tokens and configured tokens
      // This ensures major tokens are always present even if discovery fails
      const coreTokens = getCoreTokensForChain(chainId);
      allTokens.push(...coreTokens);
      logger.debug(`Chain ${chainId}: Added ${coreTokens.length} core tokens`);

      // Add extra configured tokens
      if (config.extraTokens) {
        for (const address of config.extraTokens) {
          allTokens.push({
            address: address.toLowerCase(),
            chainId,
            source: 'configured',
          });
        }
        logger.debug(`Chain ${chainId}: Added ${config.extraTokens.length} configured tokens`);
      }

      // Deduplicate and store discovered tokens
      const uniqueTokens = this.deduplicateTokens(allTokens);
      this.discoveredTokens.set(chainId, uniqueTokens);
      
      const elapsed = Date.now() - startTime;
      logger.info(`Chain ${chainId}: Discovery complete in ${elapsed}ms (${uniqueTokens.length} unique tokens)`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.error(`Token discovery failed for chain ${chainId}: ${(errorMsg || "Unknown error").substring(0, 100)}`);
      
      // Even on error, ensure core tokens are available
      const coreTokens = getCoreTokensForChain(chainId);
      const configuredTokens = (config.extraTokens || []).map((address: string) => ({
        address: address.toLowerCase(),
        chainId,
        source: 'configured',
      }));
      
      const fallbackTokens = this.deduplicateTokens([...coreTokens, ...configuredTokens]);
      this.discoveredTokens.set(chainId, fallbackTokens);
      logger.info(`Chain ${chainId}: Using ${fallbackTokens.length} fallback tokens due to discovery error`);
    }
  }

  private convertToERC20Tokens(chainId: number, tokens: TokenInfo[]): ERC20Token[] {
    const erc20Tokens: ERC20Token[] = [];
    
    for (const token of tokens) {
      erc20Tokens.push({
        address: token.address,
        symbol: token.symbol || 'UNKNOWN',
        name: token.name || 'Unknown Token',
        decimals: token.decimals || 18,
        chainId: chainId,
        source: token.source, 
      });
    }

    return erc20Tokens;
  }

  private deduplicateTokens(tokens: TokenInfo[]): TokenInfo[] {
    const seen = new Set<string>();
    const unique: TokenInfo[] = [];

    for (const token of tokens) {
      const key = token.address.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(token);
      }
    }

    return unique;
  }

  private getRpcUrl(chainId: number): string | undefined {
    // Use the existing RPC_URI_FOR_[chainId] pattern from .env
    const envKey = `RPC_URI_FOR_${chainId}`;
    return process.env[envKey];
  }

  getTokensForChain(chainId: number): ERC20Token[] {
    return this.tokenCache.get(chainId) || [];
  }

  getAllTokens(): Map<number, ERC20Token[]> {
    return this.tokenCache;
  }

  getTotalTokenCount(): number {
    let total = 0;
    for (const tokens of this.tokenCache.values()) {
      total += tokens.length;
    }
    return total;
  }

  getChainTokenCounts(): Record<number, number> {
    const counts: Record<number, number> = {};
    for (const [chainId, tokens] of this.tokenCache.entries()) {
      counts[chainId] = tokens.length;
    }
    return counts;
  }
  
  private countExpectedSources(chainId: number, config: any): number {
    const rpcUrl = this.getRpcUrl(chainId);
    let count = 0;
    
    // Count expected discovery sources
    if ((config.yearnRegistryAddress || chainId) && rpcUrl) count++;
    if (config.curveFactoryAddress || config.curveApiUrl) count++;
    if (rpcUrl) count++; // Curve Factories
    if (config.veloSugarAddress || config.veloApiUrl) count++;
    count++; // Token Lists (always)
    count++; // Gamma (always)
    count++; // Pendle (always)
    if ((config.aaveV2LendingPool || config.aaveV3Pool) && rpcUrl) count++;
    if (config.compoundComptroller && rpcUrl) count++;
    if (rpcUrl) count++; // Uniswap
    count++; // Balancer (always)
    
    return count;
  }
}

export default new TokenDiscoveryService();