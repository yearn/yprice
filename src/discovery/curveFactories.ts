import { parseAbi, type Address } from 'viem';
import { TokenInfo } from './types';
import { logger, getPublicClient, batchReadContracts } from '../utils';

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

const FACTORY_ABI = parseAbi([
  'function pool_count() view returns (uint256)',
  'function pool_list(uint256 index) view returns (address)',
  'function get_lp_token(address pool) view returns (address)',
  'function get_coins(address pool) view returns (address[2])',
]);


export class CurveFactoriesDiscovery {
  private chainId: number;
  private factories: Record<string, string> = {};

  constructor(chainId: number, _rpcUrl?: string) {
    this.chainId = chainId;
    this.factories = CURVE_FACTORIES[chainId] || {};
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    if (Object.keys(this.factories).length === 0) {
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
    const publicClient = getPublicClient(this.chainId);

    try {
      // Get pool count
      const poolCount = await publicClient.readContract({
        address: factoryAddress as Address,
        abi: FACTORY_ABI,
        functionName: 'pool_count',
      }) as bigint;
      const count = Number(poolCount);
      
      logger.info(`Chain ${this.chainId}: Curve ${factoryType} factory has ${count} pools`);

      // First, batch fetch all pool addresses
      const poolListContracts = [];
      for (let i = 0; i < count; i++) {
        poolListContracts.push({
          address: factoryAddress as Address,
          abi: FACTORY_ABI,
          functionName: 'pool_list' as const,
          args: [BigInt(i)],
        });
      }

      const poolAddresses: Address[] = [];
      const batchSize = 100;
      for (let i = 0; i < poolListContracts.length; i += batchSize) {
        const batch = poolListContracts.slice(i, i + batchSize);
        const results = await batchReadContracts<Address>(this.chainId, batch);
        
        results.forEach((result) => {
          if (result && result.status === 'success' && result.result) {
            poolAddresses.push(result.result);
          }
        });
      }

      logger.info(`Chain ${this.chainId}: Found ${poolAddresses.length} pools from Curve ${factoryType} factory`);

      // Batch fetch LP tokens for all pools
      const lpTokenContracts = poolAddresses.map(poolAddress => ({
        address: factoryAddress as Address,
        abi: FACTORY_ABI,
        functionName: 'get_lp_token' as const,
        args: [poolAddress],
      }));

      const lpTokenResults: (Address | undefined)[] = [];
      for (let i = 0; i < lpTokenContracts.length; i += batchSize) {
        const batch = lpTokenContracts.slice(i, i + batchSize);
        const results = await batchReadContracts<Address>(this.chainId, batch);
        
        results.forEach((result, index) => {
          if (result && result.status === 'success' && result.result) {
            lpTokenResults[i + index] = result.result;
          } else {
            // If get_lp_token fails, LP token is the pool itself
            lpTokenResults[i + index] = poolAddresses[i + index];
          }
        });
      }

      // Process LP tokens
      for (let i = 0; i < poolAddresses.length; i++) {
        const lpToken = lpTokenResults[i];

        if (lpToken && lpToken !== '0x0000000000000000000000000000000000000000') {
          // Add LP token
          tokens.push({
            address: lpToken.toLowerCase(),
            chainId: this.chainId,
            source: `curve-${factoryType}-lp`,
          });
        }
      }

      // Batch fetch coins for all pools (try 2-coin first)
      const coinsContracts = poolAddresses.map(poolAddress => ({
        address: factoryAddress as Address,
        abi: FACTORY_ABI,
        functionName: 'get_coins' as const,
        args: [poolAddress],
      }));

      for (let i = 0; i < coinsContracts.length; i += batchSize) {
        const batch = coinsContracts.slice(i, i + batchSize);
        const results = await batchReadContracts<readonly Address[]>(this.chainId, batch);
        
        results.forEach((result) => {
          if (result && result.status === 'success' && result.result) {
            for (const coin of result.result) {
              if (coin && coin !== '0x0000000000000000000000000000000000000000') {
                tokens.push({
                  address: coin.toLowerCase(),
                  chainId: this.chainId,
                  source: `curve-${factoryType}-coin`,
                });
              }
            }
          }
        });
      }
    } catch (error) {
      logger.error(`Error discovering from Curve factory ${factoryAddress}:`, error);
    }

    return tokens;
  }

  // Removed discoverPoolTokens - now using batch processing in discoverFromFactory

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