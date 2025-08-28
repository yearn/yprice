import { ethers } from 'ethers';
import { TokenInfo } from './types';
import { logger } from '../utils';

// Curve Factory addresses for different pool types
const CURVE_FACTORIES: Record<number, Record<string, string>> = {
  1: { // Ethereum
    'plain': '0xB9fC157394Af804a3578134A6585C0dc9cc990d4',
    'metapool': '0x0959158b6040D32d04c301A72CBFD6b39E21c9AE',
    'crypto': '0xF18056Bbd320E96A48e3Fbf8bC061322531aac99',
    'tricrypto': '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
  },
  10: { // Optimism
    'stable': '0x2db0E83599a91b508Ac268a6197b8B14F5e72840',
  },
  137: { // Polygon
    'stable': '0x722272D36ef0Da72FF51c5A65Db7b870E2e8D4ee',
  },
  250: { // Fantom
    'stable': '0x686d67265703D1f124c45E33d47d794c566889Ba',
  },
  42161: { // Arbitrum
    'stable': '0xb17b674D9c5CB2e441F8e196a2f048A81355d031',
  },
  100: { // xDai
    'stable': '0x0Ba26E3E1ebcE10032f8e5D9cF13d505F0d36187',
  },
  8453: { // Base
    'stable': '0xd2002373543Ce3527023C75e7518C274A51ce712',
  },
};

const FACTORY_ABI = [
  'function pool_count() view returns (uint256)',
  'function pool_list(uint256) view returns (address)',
  'function get_lp_token(address) view returns (address)',
  'function get_coins(address) view returns (address[2])',
  'function get_coins(address) view returns (address[4])',
];


export class CurveFactoriesDiscovery {
  private chainId: number;
  private provider?: ethers.Provider;
  private factories: Record<string, string> = {};

  constructor(chainId: number, rpcUrl?: string) {
    this.chainId = chainId;
    this.factories = CURVE_FACTORIES[chainId] || {};
    
    if (rpcUrl && Object.keys(this.factories).length > 0) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    if (!this.provider || Object.keys(this.factories).length === 0) {
      return tokens;
    }

    for (const [factoryType, factoryAddress] of Object.entries(this.factories)) {
      try {
        logger.info(`Chain ${this.chainId}: Discovering Curve ${factoryType} factory pools from ${factoryAddress}`);
        const factoryTokens = await this.discoverFromFactory(factoryAddress, factoryType);
        tokens.push(...factoryTokens);
        logger.info(`Chain ${this.chainId}: Found ${factoryTokens.length} tokens from Curve ${factoryType} factory`);
      } catch (error: any) {
        logger.warn(`Chain ${this.chainId}: Failed to discover from Curve ${factoryType} factory:`, error.message);
      }
    }

    return this.deduplicateTokens(tokens);
  }

  private async discoverFromFactory(factoryAddress: string, factoryType: string): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    if (!this.provider) return tokens;

    try {
      const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, this.provider);
      
      // Get pool count
      const poolCountFunc = factory['pool_count'];
      if (!poolCountFunc) return tokens;
      const poolCount = await poolCountFunc();
      const count = Number(poolCount);
      
      logger.info(`Chain ${this.chainId}: Curve ${factoryType} factory has ${count} pools`);

      // Batch pool discovery to avoid overwhelming the RPC
      const batchSize = 50;
      for (let i = 0; i < count; i += batchSize) {
        const batch = [];
        for (let j = i; j < Math.min(i + batchSize, count); j++) {
          batch.push(this.discoverPoolTokens(factory, j, factoryType));
        }
        
        const batchTokens = await Promise.all(batch);
        batchTokens.forEach(poolTokens => tokens.push(...poolTokens));
        
        // Small delay between batches
        if (i + batchSize < count) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } catch (error) {
      logger.error(`Error discovering from Curve factory ${factoryAddress}:`, error);
    }

    return tokens;
  }

  private async discoverPoolTokens(
    factory: ethers.Contract, 
    poolIndex: number,
    factoryType: string
  ): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    try {
      // Get pool address
      const poolListFunc = factory['pool_list'];
      if (!poolListFunc) return tokens;
      const poolAddress = await poolListFunc(poolIndex);
      
      // Get LP token address
      let lpToken: string | undefined;
      try {
        const getLpTokenFunc = factory['get_lp_token'];
        if (getLpTokenFunc) {
          lpToken = await getLpTokenFunc(poolAddress);
        }
      } catch {
        // Some factories don't have get_lp_token, LP token is the pool itself
        lpToken = poolAddress;
      }
      
      if (lpToken && lpToken !== '0x0000000000000000000000000000000000000000') {
        // Add LP token
        tokens.push({
          address: lpToken.toLowerCase(),
          chainId: this.chainId,
          source: `curve-${factoryType}-lp`,
        });

        // Try to get pool coins
        try {
          const getCoins = factory['get_coins(address)'] || factory['get_coins'];
          if (getCoins) {
            const coins = await getCoins(poolAddress);
            for (const coin of coins) {
              if (coin && coin !== '0x0000000000000000000000000000000000000000') {
                tokens.push({
                  address: coin.toLowerCase(),
                  chainId: this.chainId,
                  source: `curve-${factoryType}-coin`,
                });
              }
            }
          }
        } catch {
          // Some pools might have different interfaces
        }
      }
    } catch (error) {
      // Silent fail for individual pools
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