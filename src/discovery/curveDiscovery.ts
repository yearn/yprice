import axios from 'axios';
import { ethers } from 'ethers';
import { TokenInfo, CurvePoolData } from './types';
import { logger } from '../utils';

const CURVE_FACTORY_ABI = [
  'function pool_count() view returns (uint256)',
  'function pool_list(uint256) view returns (address)',
  'function get_coins(address) view returns (address[2])',
];

export class CurveDiscovery {
  private chainId: number;
  private factoryAddress?: string;
  private apiUrl?: string;
  private provider?: ethers.Provider;

  constructor(chainId: number, factoryAddress?: string, apiUrl?: string, rpcUrl?: string) {
    this.chainId = chainId;
    this.factoryAddress = factoryAddress;
    this.apiUrl = apiUrl;
    
    if (rpcUrl && factoryAddress) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
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
      if (tokens.length === 0 && this.factoryAddress && this.provider) {
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
    
    if (!this.provider || !this.factoryAddress) {
      return tokens;
    }

    try {
      const factory = new ethers.Contract(
        this.factoryAddress,
        CURVE_FACTORY_ABI,
        this.provider
      );

      const poolCount = await (factory as any).pool_count();
      const maxPools = Math.min(Number(poolCount), 500); // Limit to prevent too many calls

      logger.info(`Fetching ${maxPools} Curve pools from chain ${this.chainId}`);

      // Batch fetch pool addresses
      const poolPromises = [];
      for (let i = 0; i < maxPools; i++) {
        poolPromises.push((factory as any).pool_list(i));
      }
      
      const poolAddresses = await Promise.all(poolPromises);

      // Batch fetch coins for each pool
      const coinPromises = poolAddresses.map(poolAddr => 
        (factory as any).get_coins(poolAddr).catch(() => null)
      );
      
      const poolCoins = await Promise.all(coinPromises);

      for (let i = 0; i < poolAddresses.length; i++) {
        const poolAddress = poolAddresses[i];
        const coins = poolCoins[i];

        // Add pool as LP token
        tokens.push({
          address: poolAddress.toLowerCase(),
          chainId: this.chainId,
          source: 'curve-lp',
        });

        // Add underlying coins
        if (coins) {
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
      }
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