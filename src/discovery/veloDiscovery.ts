import axios from 'axios';
import https from 'https';
import { type Address } from 'viem';
import { TokenInfo, VeloPoolData } from './types';
import { logger, getPublicClient } from '../utils';

// Sugar ABI - complex tuple needs to be defined as a proper ABI object for viem
const SUGAR_ABI = [
  {
    inputs: [
      { name: 'limit', type: 'uint256' },
      { name: 'offset', type: 'uint256' }
    ],
    name: 'all',
    outputs: [
      {
        components: [
          { name: 'lp', type: 'address' },
          { name: 'symbol', type: 'string' },
          { name: 'decimals', type: 'uint8' },
          { name: 'liquidity', type: 'uint256' },
          { name: 'type', type: 'int24' },
          { name: 'tick', type: 'int24' },
          { name: 'sqrt_ratio', type: 'uint160' },
          { name: 'token0', type: 'address' },
          { name: 'reserve0', type: 'uint256' },
          { name: 'staked0', type: 'uint256' },
          { name: 'token1', type: 'address' },
          { name: 'reserve1', type: 'uint256' },
          { name: 'staked1', type: 'uint256' },
          { name: 'gauge', type: 'address' },
          { name: 'gauge_liquidity', type: 'uint256' },
          { name: 'gauge_alive', type: 'bool' },
          { name: 'fee', type: 'address' },
          { name: 'bribe', type: 'address' },
          { name: 'factory', type: 'address' },
          { name: 'emissions', type: 'uint256' },
          { name: 'emissions_token', type: 'address' },
          { name: 'pool_fee', type: 'uint256' },
          { name: 'unstaked_fee', type: 'uint256' },
          { name: 'token0_fees', type: 'uint256' },
          { name: 'token1_fees', type: 'uint256' }
        ],
        name: '',
        type: 'tuple[]'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

interface SugarPoolData {
  lp: string;
  symbol: string;
  decimals: number;
  liquidity: bigint;
  type: number;
  tick: number;
  sqrt_ratio: bigint;
  token0: string;
  reserve0: bigint;
  staked0: bigint;
  token1: string;
  reserve1: bigint;
  staked1: bigint;
  gauge: string;
  gauge_liquidity: bigint;
  gauge_alive: boolean;
  fee: string;
  bribe: string;
  factory: string;
  emissions: bigint;
  emissions_token: string;
  pool_fee: bigint;
  unstaked_fee: bigint;
  token0_fees: bigint;
  token1_fees: bigint;
}

export class VeloDiscovery {
  private chainId: number;
  private sugarAddress?: string;
  private apiUrl?: string;

  constructor(chainId: number, sugarAddress?: string, apiUrl?: string, _rpcUrl?: string) {
    this.chainId = chainId;
    this.sugarAddress = sugarAddress;
    this.apiUrl = apiUrl;
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    try {
      // Try API first as it's faster
      if (this.apiUrl) {
        const apiTokens = await this.discoverFromAPI();
        tokens.push(...apiTokens);
      }
      
      // If API fails or is not available, try on-chain discovery
      if (tokens.length === 0 && this.sugarAddress) {
        const onChainTokens = await this.discoverFromContract();
        tokens.push(...onChainTokens);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.warn(`Velodrome discovery failed for chain ${this.chainId}: ${(errorMsg || "Unknown error").substring(0, 100)}`);
    }

    return this.deduplicateTokens(tokens);
  }

  private async discoverFromAPI(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    try {
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false // Temporarily disable SSL verification
      });
      
      const response = await axios.get<{ data: VeloPoolData[] }>(
        this.apiUrl!,
        { 
          timeout: 30000,
          headers: { 'User-Agent': 'yearn-pricing-service' },
          httpsAgent: httpsAgent
        }
      );

      if (response.data?.data) {
        for (const pool of response.data.data) {
          // Add LP token
          tokens.push({
            address: pool.address.toLowerCase(),
            chainId: this.chainId,
            source: 'velo-lp',
            symbol: pool.symbol,
          });

          // Add token0
          if (pool.token0 && pool.token0 !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: pool.token0.toLowerCase(),
              chainId: this.chainId,
              source: 'velo-token',
            });
          }

          // Add token1
          if (pool.token1 && pool.token1 !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: pool.token1.toLowerCase(),
              chainId: this.chainId,
              source: 'velo-token',
            });
          }
        }
      }
    } catch (error: any) {
      logger.warn(`Velodrome API fetch failed for chain ${this.chainId}: ${error.message}`);
      if (error.response) {
        logger.debug(`Response status: ${error.response.status}, data: ${JSON.stringify(error.response.data).substring(0, 200)}`);
      }
    }

    return tokens;
  }

  private async discoverFromContract(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    if (!this.sugarAddress) {
      return tokens;
    }

    const publicClient = getPublicClient(this.chainId);

    try {
      const batchSize = 25;
      const maxBatches = 39; // Stop before batch 39 which fails on Optimism
      
      logger.debug(`Fetching Velodrome/Aerodrome pools from Sugar contract ${this.sugarAddress} on chain ${this.chainId}`);

      for (let i = 0; i < maxBatches; i++) {
        try {
          const offset = i * batchSize;
          logger.debug(`Fetching batch ${i} (offset: ${offset}) from Sugar contract on chain ${this.chainId}`);
          
          // Add timeout to prevent hanging
          const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Sugar call timeout')), 10000)
          );
          
          const poolsPromise = publicClient.readContract({
            address: this.sugarAddress as Address,
            abi: SUGAR_ABI,
            functionName: 'all',
            args: [BigInt(batchSize), BigInt(offset)],
          });
          
          const pools = await Promise.race([poolsPromise, timeoutPromise]) as SugarPoolData[];
          
          if (!pools || pools.length === 0) {
            logger.debug(`No more pools after batch ${i}`);
            break;
          }
          
          logger.debug(`Batch ${i}: Found ${pools.length} pools`);

          for (const pool of pools) {
            // Add LP token
            tokens.push({
              address: pool.lp.toLowerCase(),
              chainId: this.chainId,
              source: 'velo-lp',
            });

            // Add token0
            if (pool.token0 && pool.token0 !== '0x0000000000000000000000000000000000000000') {
              tokens.push({
                address: pool.token0.toLowerCase(),
                chainId: this.chainId,
                source: 'velo-token',
              });
            }

            // Add token1
            if (pool.token1 && pool.token1 !== '0x0000000000000000000000000000000000000000') {
              tokens.push({
                address: pool.token1.toLowerCase(),
                chainId: this.chainId,
                source: 'velo-token',
              });
            }
          }
        } catch (batchError: any) {
          // Log the error but continue trying next batches
          logger.warn(`Velodrome Sugar batch ${i} failed on chain ${this.chainId}: ${batchError.message || batchError}`);
          // Try reducing batch size if we hit gas limits
          if (i === 0) {
            logger.error(`First batch failed - Sugar contract may be incorrect or inaccessible`);
            break;
          }
          // Continue to next batch instead of breaking
          continue;
        }
      }
      const uniqueTokens = new Set(tokens.map(t => t.address.toLowerCase()));
      logger.debug(`Velodrome Sugar discovery completed: found ${uniqueTokens.size} unique tokens from ${tokens.length} total entries on chain ${this.chainId}`);
    } catch (error: any) {
      logger.error(`Velodrome contract discovery failed for chain ${this.chainId}:`, error.message || error);
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