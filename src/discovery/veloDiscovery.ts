import axios from 'axios';
import { ethers } from 'ethers';
import { TokenInfo, VeloPoolData } from './types';
import { logger } from '../utils';

const SUGAR_ABI = [
  'function all(uint256 limit, uint256 offset) view returns (tuple(address lp, string symbol, uint8 decimals, uint256 liquidity, int24 type, int24 tick, uint160 sqrt_ratio, address token0, uint256 reserve0, uint256 staked0, address token1, uint256 reserve1, uint256 staked1, address gauge, uint256 gauge_liquidity, bool gauge_alive, address fee, address bribe, address factory, uint256 emissions, address emissions_token, uint256 pool_fee, uint256 unstaked_fee, uint256 token0_fees, uint256 token1_fees)[])',
];

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
  private provider?: ethers.Provider;

  constructor(chainId: number, sugarAddress?: string, apiUrl?: string, rpcUrl?: string) {
    this.chainId = chainId;
    this.sugarAddress = sugarAddress;
    this.apiUrl = apiUrl;
    
    if (rpcUrl && sugarAddress) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
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
      if (tokens.length === 0 && this.sugarAddress && this.provider) {
        const onChainTokens = await this.discoverFromContract();
        tokens.push(...onChainTokens);
      }
    } catch (error) {
      logger.error(`Velodrome discovery failed for chain ${this.chainId}:`, error);
    }

    return this.deduplicateTokens(tokens);
  }

  private async discoverFromAPI(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    try {
      const response = await axios.get<{ data: VeloPoolData[] }>(
        this.apiUrl!,
        { 
          timeout: 30000,
          headers: { 'User-Agent': 'yearn-pricing-service' }
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
      logger.warn(`Velodrome API fetch failed for chain ${this.chainId}:`, error.message);
    }

    return tokens;
  }

  private async discoverFromContract(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    if (!this.provider || !this.sugarAddress) {
      return tokens;
    }

    try {
      const sugar = new ethers.Contract(
        this.sugarAddress,
        SUGAR_ABI,
        this.provider
      );

      const batchSize = 25;
      const maxBatches = 39; // Stop before batch 39 which fails on Optimism
      
      logger.info(`Fetching Velodrome/Aerodrome pools from Sugar contract ${this.sugarAddress} on chain ${this.chainId}`);

      for (let i = 0; i < maxBatches; i++) {
        try {
          const offset = i * batchSize;
          logger.debug(`Fetching batch ${i} (offset: ${offset}) from Sugar contract on chain ${this.chainId}`);
          
          // Add timeout to prevent hanging
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Sugar call timeout')), 10000)
          );
          const poolsPromise = (sugar as any).all(batchSize, offset);
          const pools: SugarPoolData[] = await Promise.race([poolsPromise, timeoutPromise]) as SugarPoolData[];
          
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
          logger.warn(`Velodrome Sugar batch ${i} failed on chain ${this.chainId}:`, batchError.message || batchError);
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
      logger.info(`Velodrome Sugar discovery completed: found ${uniqueTokens.size} unique tokens from ${tokens.length} total entries on chain ${this.chainId}`);
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