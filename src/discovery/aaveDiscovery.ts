import { parseAbi, type Address } from 'viem';
import { TokenInfo } from './types';
import { logger, getPublicClient, batchReadContracts } from '../utils';

const AAVE_V2_LENDING_POOL_ABI = parseAbi([
  'function getReservesList() view returns (address[])',
]);

// AAVE V3 Pool ABI - complex tuple needs proper object definition
const AAVE_V3_POOL_ABI = [
  {
    inputs: [],
    name: 'getReservesList',
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'asset', type: 'address' }],
    name: 'getReserveData',
    outputs: [
      {
        components: [
          { name: 'configuration', type: 'uint256' },
          { name: 'liquidityIndex', type: 'uint128' },
          { name: 'currentLiquidityRate', type: 'uint128' },
          { name: 'variableBorrowIndex', type: 'uint128' },
          { name: 'currentVariableBorrowRate', type: 'uint128' },
          { name: 'currentStableBorrowRate', type: 'uint128' },
          { name: 'lastUpdateTimestamp', type: 'uint40' },
          { name: 'id', type: 'uint16' },
          { name: 'aTokenAddress', type: 'address' },
          { name: 'stableDebtTokenAddress', type: 'address' },
          { name: 'variableDebtTokenAddress', type: 'address' },
          { name: 'interestRateStrategyAddress', type: 'address' },
          { name: 'accruedToTreasury', type: 'uint128' },
          { name: 'unbacked', type: 'uint128' },
          { name: 'isolationModeTotalDebt', type: 'uint128' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

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

  constructor(chainId: number, v2PoolAddress?: string, v3PoolAddress?: string, _rpcUrl?: string) {
    this.chainId = chainId;
    this.v2PoolAddress = v2PoolAddress;
    this.v3PoolAddress = v3PoolAddress;
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];

    try {
      // Discover AAVE V3 tokens
      if (this.v3PoolAddress) {
        const v3Tokens = await this.discoverV3Tokens();
        tokens.push(...v3Tokens);
        logger.debug(`Chain ${this.chainId}: Discovered ${v3Tokens.length} AAVE V3 tokens`);
      }

      // Discover AAVE V2 tokens
      if (this.v2PoolAddress) {
        const v2Tokens = await this.discoverV2Tokens();
        tokens.push(...v2Tokens);
        logger.debug(`Chain ${this.chainId}: Discovered ${v2Tokens.length} AAVE V2 tokens`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.warn(`AAVE discovery failed for chain ${this.chainId}: ${(errorMsg || "Unknown error").substring(0, 100)}`);
    }

    return this.deduplicateTokens(tokens);
  }

  private async discoverV3Tokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    if (!this.v3PoolAddress) {
      return tokens;
    }

    const publicClient = getPublicClient(this.chainId);

    try {
      // Get all reserve tokens
      const reserves = await publicClient.readContract({
        address: this.v3PoolAddress as Address,
        abi: AAVE_V3_POOL_ABI,
        functionName: 'getReservesList',
      }) as Address[];
      
      // Batch fetch all reserve data
      const reserveDataContracts = reserves.map(reserve => ({
        address: this.v3PoolAddress as Address,
        abi: AAVE_V3_POOL_ABI,
        functionName: 'getReserveData' as const,
        args: [reserve],
      }));

      type ReserveData = {
        configuration: bigint;
        liquidityIndex: bigint;
        currentLiquidityRate: bigint;
        variableBorrowIndex: bigint;
        currentVariableBorrowRate: bigint;
        currentStableBorrowRate: bigint;
        lastUpdateTimestamp: number;
        id: number;
        aTokenAddress: Address;
        stableDebtTokenAddress: Address;
        variableDebtTokenAddress: Address;
        interestRateStrategyAddress: Address;
        accruedToTreasury: bigint;
        unbacked: bigint;
        isolationModeTotalDebt: bigint;
      };

      const reserveDataResults = await batchReadContracts<ReserveData>(this.chainId, reserveDataContracts);
      
      reserves.forEach((reserve, index) => {
        // Add underlying token
        tokens.push({
          address: reserve.toLowerCase(),
          chainId: this.chainId,
          source: 'aave-underlying',
        });

        const result = reserveDataResults[index];
        if (result && result.status === 'success' && result.result) {
          const reserveData = result.result;
          
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
        }
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.warn(`AAVE V3 discovery failed for chain ${this.chainId}: ${(errorMsg || "Unknown error").substring(0, 100)}`);
    }

    return tokens;
  }

  private async discoverV2Tokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    if (!this.v2PoolAddress) {
      return tokens;
    }

    const publicClient = getPublicClient(this.chainId);

    try {
      // Get all reserve tokens
      const reserves = await publicClient.readContract({
        address: this.v2PoolAddress as Address,
        abi: AAVE_V2_LENDING_POOL_ABI,
        functionName: 'getReservesList',
      }) as Address[];
      
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
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.warn(`AAVE V2 discovery failed for chain ${this.chainId}: ${(errorMsg || "Unknown error").substring(0, 100)}`);
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