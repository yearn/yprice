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

    // Discover tokens for each chain in parallel
    const discoveryPromises: Promise<void>[] = [];
    
    for (const [chainId, config] of Object.entries(DISCOVERY_CONFIGS)) {
      discoveryPromises.push(this.discoverChainTokens(Number(chainId), config));
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
    
    logger.info(`✅ Token discovery complete: ${totalTokens} tokens across ${this.tokenCache.size} chains`);

    this.lastDiscovery = now;
    return this.tokenCache;
  }

  private async discoverChainTokens(chainId: number, config: any): Promise<void> {
    const tokens: TokenInfo[] = [];
    
    try {
      // Get RPC URL from environment
      const rpcUrl = this.getRpcUrl(chainId);

      // 0. ALWAYS add core tokens first (WETH, USDC, USDT, DAI, etc)
      const coreTokens = getCoreTokensForChain(chainId);
      tokens.push(...coreTokens);
      logger.info(`Chain ${chainId}: Discovering tokens... (${tokens.length} found)`);

      // 1. Add extra configured tokens
      if (config.extraTokens) {
        for (const address of config.extraTokens) {
          tokens.push({
            address: address.toLowerCase(),
            chainId,
            source: 'configured',
          });
        }
        logger.info(`Chain ${chainId}: Discovering tokens... (${tokens.length} found)`);
      }

      // 2. Discover Yearn vaults
      if (config.yearnRegistryAddress || chainId) {
        const yearnDiscovery = new YearnDiscovery(chainId, rpcUrl);
        const yearnTokens = await yearnDiscovery.discoverTokens();
        tokens.push(...yearnTokens);
        if (yearnTokens.length > 0) {
          logger.info(`Chain ${chainId}: Discovering tokens... (${tokens.length} found)`);
        }
      }

      // 3. Discover Curve pools from API
      if (config.curveFactoryAddress || config.curveApiUrl) {
        const curveDiscovery = new CurveDiscovery(
          chainId,
          config.curveFactoryAddress,
          config.curveApiUrl,
          rpcUrl
        );
        
        const curveTokens = await curveDiscovery.discoverTokens();
        tokens.push(...curveTokens);
        logger.debug(`Chain ${chainId}: Discovered ${curveTokens.length} Curve tokens from API`);
      }

      // 3b. Discover ALL Curve factory pools (comprehensive)
      if (rpcUrl) {
        const curveFactoriesDiscovery = new CurveFactoriesDiscovery(chainId, rpcUrl);
        const curveFactoryTokens = await curveFactoriesDiscovery.discoverTokens();
        tokens.push(...curveFactoryTokens);
        if (curveFactoryTokens.length > 0) {
          logger.debug(`Chain ${chainId}: Discovered ${curveFactoryTokens.length} Curve factory tokens`);
        }
      }

      // 4. Discover Velodrome/Aerodrome pools
      if (config.veloSugarAddress || config.veloApiUrl) {
        const veloDiscovery = new VeloDiscovery(
          chainId,
          config.veloSugarAddress,
          config.veloApiUrl,
          rpcUrl
        );
        
        const veloTokens = await veloDiscovery.discoverTokens();
        tokens.push(...veloTokens);
        logger.debug(`Chain ${chainId}: Discovered ${veloTokens.length} Velodrome/Aerodrome tokens`);
      }

      // 5. Load from token lists (Uniswap, 1inch, CoinGecko, etc.)
      const tokenListTokens = await tokenListDiscovery.discoverTokens(chainId);
      tokens.push(...tokenListTokens.map((t: ERC20Token) => ({
        address: t.address,
        chainId: t.chainId,
        source: 'tokenlist',
      })));
      if (tokenListTokens.length > 0) {
        logger.info(`Chain ${chainId}: Discovering tokens... (${tokens.length} found)`);
      }

      // 6. Discover Gamma Protocol tokens
      const gammaDiscovery = new GammaDiscovery(chainId);
      const gammaTokens = await gammaDiscovery.discoverTokens();
      tokens.push(...gammaTokens);
      if (gammaTokens.length > 0) {
        logger.debug(`Chain ${chainId}: Discovered ${gammaTokens.length} Gamma tokens`);
      }

      // 7. Discover Pendle tokens
      const pendleDiscovery = new PendleDiscovery(chainId);
      const pendleTokens = await pendleDiscovery.discoverTokens();
      tokens.push(...pendleTokens);
      if (pendleTokens.length > 0) {
        logger.debug(`Chain ${chainId}: Discovered ${pendleTokens.length} Pendle tokens`);
      }

      // 8. Discover AAVE tokens
      if (config.aaveV2LendingPool || config.aaveV3Pool) {
        const aaveDiscovery = new AAVEDiscovery(
          chainId,
          config.aaveV2LendingPool,
          config.aaveV3Pool,
          rpcUrl
        );
        
        const aaveTokens = await aaveDiscovery.discoverTokens();
        tokens.push(...aaveTokens);
        if (aaveTokens.length > 0) {
          logger.debug(`Chain ${chainId}: Discovered ${aaveTokens.length} AAVE tokens`);
        }
      }

      // 9. Discover Compound tokens
      if (config.compoundComptroller) {
        const compoundDiscovery = new CompoundDiscovery(
          chainId,
          config.compoundComptroller,
          rpcUrl
        );
        
        const compoundTokens = await compoundDiscovery.discoverTokens();
        tokens.push(...compoundTokens);
        if (compoundTokens.length > 0) {
          logger.debug(`Chain ${chainId}: Discovered ${compoundTokens.length} Compound tokens`);
        }
      }

      // 10. Discover Uniswap tokens
      const uniswapDiscovery = new UniswapDiscovery(chainId);
      const uniswapTokens = await uniswapDiscovery.discoverTokens();
      tokens.push(...uniswapTokens);
      if (uniswapTokens.length > 0) {
        logger.debug(`Chain ${chainId}: Discovered ${uniswapTokens.length} Uniswap tokens`);
      }

      // 11. Discover Balancer tokens
      const balancerDiscovery = new BalancerDiscovery(chainId);
      const balancerTokens = await balancerDiscovery.discoverTokens();
      tokens.push(...balancerTokens);
      if (balancerTokens.length > 0) {
        logger.debug(`Chain ${chainId}: Discovered ${balancerTokens.length} Balancer tokens`);
      }

      // Store discovered tokens
      const uniqueTokens = this.deduplicateTokens(tokens);
      this.discoveredTokens.set(chainId, uniqueTokens);
      logger.info(`Chain ${chainId}: Discovery complete (${uniqueTokens.length} unique tokens)`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.warn(`Token discovery failed for chain ${chainId}: ${(errorMsg || "Unknown error").substring(0, 100)}`);
      // Store empty array on error to prevent retrying too frequently
      this.discoveredTokens.set(chainId, []);
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
}

export default new TokenDiscoveryService();