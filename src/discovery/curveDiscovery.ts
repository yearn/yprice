import axios from 'axios';
import { parseAbi, type Address } from 'viem';
import { TokenInfo, CurvePoolData } from './types';
import { logger, getPublicClient, batchReadContracts } from '../utils';

const CURVE_FACTORY_ABI = parseAbi([
  'function pool_count() view returns (uint256)',
  'function pool_list(uint256 index) view returns (address)',
  'function get_coins(address pool) view returns (address[2])',
]);

export class CurveDiscovery {
  private chainId: number;
  private factoryAddress?: string;
  private apiUrl?: string;

  constructor(chainId: number, factoryAddress?: string, apiUrl?: string, _rpcUrl?: string) {
    this.chainId = chainId;
    this.factoryAddress = factoryAddress;
    this.apiUrl = apiUrl;
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    try {
      // Try API first as it's faster and more complete
      if (this.apiUrl) {
        const apiTokens = await this.discoverFromAPI();
        tokens.push(...apiTokens);
      }
      
      // If API fails or is not available, try on-chain discovery
      if (tokens.length === 0 && this.factoryAddress) {
        const onChainTokens = await this.discoverFromContract();
        tokens.push(...onChainTokens);
      }
    } catch (error) {
      logger.error(`Curve discovery failed for chain ${this.chainId}:`, error);
    }

    return this.deduplicateTokens(tokens);
  }

  private async discoverFromAPI(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    try {
      const response = await axios.get<{ success: boolean; data: { poolData: CurvePoolData[] } }>(
        this.apiUrl!,
        { 
          timeout: 30000,
          headers: { 'User-Agent': 'yearn-pricing-service' }
        }
      );

      if (response.data?.success && response.data.data?.poolData) {
        for (const pool of response.data.data.poolData) {
          // Add LP token
          if (pool.lpTokenAddress) {
            tokens.push({
              address: pool.lpTokenAddress.toLowerCase(),
              chainId: this.chainId,
              source: 'curve-lp',
              name: pool.name,
              symbol: pool.symbol,
            });
          }

          // Add coin tokens
          for (const coin of pool.coins || []) {
            if (coin && coin !== '0x0000000000000000000000000000000000000000') {
              tokens.push({
                address: coin.toLowerCase(),
                chainId: this.chainId,
                source: 'curve-coin',
              });
            }
          }
        }
      }
    } catch (error: any) {
      logger.warn(`Curve API fetch failed for chain ${this.chainId}:`, error.message);
    }

    return tokens;
  }

  private async discoverFromContract(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    if (!this.factoryAddress) {
      return tokens;
    }

    const publicClient = getPublicClient(this.chainId);

    try {
      const poolCount = await publicClient.readContract({
        address: this.factoryAddress as Address,
        abi: CURVE_FACTORY_ABI,
        functionName: 'pool_count',
      }) as bigint;
      const maxPools = Math.min(Number(poolCount), 500); // Limit to prevent too many calls

      logger.info(`Fetching ${maxPools} Curve pools from chain ${this.chainId}`);

      // Batch fetch pool addresses using multicall
      const poolListContracts = [];
      for (let i = 0; i < maxPools; i++) {
        poolListContracts.push({
          address: this.factoryAddress as Address,
          abi: CURVE_FACTORY_ABI,
          functionName: 'pool_list' as const,
          args: [BigInt(i)],
        });
      }
      
      const poolAddressResults = await batchReadContracts<Address>(this.chainId, poolListContracts);
      const poolAddresses: Address[] = [];
      
      poolAddressResults.forEach((result) => {
        if (result && result.status === 'success' && result.result) {
          poolAddresses.push(result.result);
        }
      });

      // Add all pools as LP tokens
      for (const poolAddress of poolAddresses) {
        tokens.push({
          address: poolAddress.toLowerCase(),
          chainId: this.chainId,
          source: 'curve-lp',
        });
      }

      // Batch fetch coins for each pool using multicall
      const coinContracts = poolAddresses.map(poolAddr => ({
        address: this.factoryAddress as Address,
        abi: CURVE_FACTORY_ABI,
        functionName: 'get_coins' as const,
        args: [poolAddr],
      }));
      
      const coinResults = await batchReadContracts<readonly Address[]>(this.chainId, coinContracts);

      coinResults.forEach((result) => {
        if (result && result.status === 'success' && result.result) {
          const coins = result.result;
          for (const coin of coins) {
            if (coin && coin !== '0x0000000000000000000000000000000000000000') {
              tokens.push({
                address: coin.toLowerCase(),
                chainId: this.chainId,
                source: 'curve-coin',
              });
            }
          }
        }
      });
    } catch (error) {
      logger.error(`Curve contract discovery failed for chain ${this.chainId}:`, error);
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