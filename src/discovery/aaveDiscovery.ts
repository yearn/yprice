import { ethers } from 'ethers';
import { TokenInfo } from './types';
import { logger } from '../utils';

const AAVE_V2_LENDING_POOL_ABI = [
  'function getReservesList() view returns (address[])',
];

const AAVE_V3_POOL_ABI = [
  'function getReservesList() view returns (address[])',
  'function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
];

// AToken ABI - currently unused but available for future enhancements
// const ATOKEN_ABI = [
//   'function UNDERLYING_ASSET_ADDRESS() view returns (address)',
//   'function underlyingAssetAddress() view returns (address)',
//   'function symbol() view returns (string)',
//   'function name() view returns (string)',
//   'function decimals() view returns (uint8)',
// ];

export class AAVEDiscovery {
  private chainId: number;
  private v2PoolAddress?: string;
  private v3PoolAddress?: string;
  private provider?: ethers.Provider;

  constructor(chainId: number, v2PoolAddress?: string, v3PoolAddress?: string, rpcUrl?: string) {
    this.chainId = chainId;
    this.v2PoolAddress = v2PoolAddress;
    this.v3PoolAddress = v3PoolAddress;
    
    if (rpcUrl && (v2PoolAddress || v3PoolAddress)) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];

    try {
      // Discover AAVE V3 tokens
      if (this.v3PoolAddress && this.provider) {
        const v3Tokens = await this.discoverV3Tokens();
        tokens.push(...v3Tokens);
        logger.info(`Chain ${this.chainId}: Discovered ${v3Tokens.length} AAVE V3 tokens`);
      }

      // Discover AAVE V2 tokens
      if (this.v2PoolAddress && this.provider) {
        const v2Tokens = await this.discoverV2Tokens();
        tokens.push(...v2Tokens);
        logger.info(`Chain ${this.chainId}: Discovered ${v2Tokens.length} AAVE V2 tokens`);
      }
    } catch (error) {
      logger.error(`AAVE discovery failed for chain ${this.chainId}:`, error);
    }

    return this.deduplicateTokens(tokens);
  }

  private async discoverV3Tokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    if (!this.provider || !this.v3PoolAddress) {
      return tokens;
    }

    try {
      const pool = new ethers.Contract(
        this.v3PoolAddress,
        AAVE_V3_POOL_ABI,
        this.provider
      );

      // Get all reserve tokens
      const reserves = await (pool as any).getReservesList();
      
      for (const reserve of reserves) {
        // Add underlying token
        tokens.push({
          address: reserve.toLowerCase(),
          chainId: this.chainId,
          source: 'aave-underlying',
        });

        // Get reserve data to find aToken address
        try {
          const reserveData = await (pool as any).getReserveData(reserve);
          if (reserveData.aTokenAddress && reserveData.aTokenAddress !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: reserveData.aTokenAddress.toLowerCase(),
              chainId: this.chainId,
              source: 'aave-v3-atoken',
            });
          }
          
          // Also add debt tokens if needed
          if (reserveData.variableDebtTokenAddress && reserveData.variableDebtTokenAddress !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: reserveData.variableDebtTokenAddress.toLowerCase(),
              chainId: this.chainId,
              source: 'aave-v3-debt',
            });
          }
        } catch (error) {
          // Skip if we can't get reserve data
          logger.debug(`Failed to get reserve data for ${reserve}:`, error);
        }
      }
    } catch (error) {
      logger.error(`AAVE V3 discovery failed for chain ${this.chainId}:`, error);
    }

    return tokens;
  }

  private async discoverV2Tokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    if (!this.provider || !this.v2PoolAddress) {
      return tokens;
    }

    try {
      const pool = new ethers.Contract(
        this.v2PoolAddress,
        AAVE_V2_LENDING_POOL_ABI,
        this.provider
      );

      // Get all reserve tokens
      const reserves = await (pool as any).getReservesList();
      
      for (const reserve of reserves) {
        // Add underlying token
        tokens.push({
          address: reserve.toLowerCase(),
          chainId: this.chainId,
          source: 'aave-underlying',
        });

        // For V2, we'd need to query each reserve's aToken separately
        // This would require additional contract calls
      }
    } catch (error) {
      logger.error(`AAVE V2 discovery failed for chain ${this.chainId}:`, error);
    }

    return tokens;
  }

  private deduplicateTokens(tokens: TokenInfo[]): TokenInfo[] {
    const seen = new Set<string>();
    const unique: TokenInfo[] = [];

    for (const token of tokens) {
      const key = `${token.chainId}-${token.address.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(token);
      }
    }

    return unique;
  }
}