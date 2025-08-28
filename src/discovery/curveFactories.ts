import { parseAbi, type Address } from 'viem';
import { TokenInfo } from './types';
import { logger, getPublicClient, batchReadContracts } from '../utils';

// Curve Factory addresses for different pool types (comprehensive list from ydaemon)
const CURVE_FACTORIES: Record<number, Record<string, string>> = {
  1: { // Ethereum - COMPREHENSIVE list
    'plain': '0xB9fC157394Af804a3578134A6585C0dc9cc990d4',
    'metapool': '0x0959158b6040D32d04c301A72CBFD6b39E21c9AE',
    'crypto': '0xF18056Bbd320E96A48e3Fbf8bC061322531aac99',
    'tricrypto': '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
    'stable-ng': '0x6A8cbed756804B16E05E741eDaBd5cB544AE21bf',
    'twocrypto-ng': '0x98EE851a00abeE0d95D08cF4CA2BdCE32aeaAF7F',
    'tricrypto-ng': '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
    'eywa': '0xaB33A8a67545b5208B892bd7Db9B005E7d558cD5',
  },
  10: { // Optimism
    'stable': '0x2db0E83599a91b508Ac268a6197b8B14F5e72840',
    'stable-ng': '0x5eeE3091f747E60a045a2E715a4c71e600e31F6E',
    'twocrypto-ng': '0xd7E72f3615aa65b92A4DBdC211E296a35512988B',
    'tricrypto': '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
  },
  137: { // Polygon
    'stable': '0x722272D36ef0Da72FF51c5A65Db7b870E2e8D4ee',
    'stable-ng': '0x1764ee18e8B3ccA4787249Ceb249356192594585',
    'twocrypto-ng': '0x4A32De8c248533C28904b24B4cFCFE18E9F2ad01',
    'tricrypto': '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
  },
  250: { // Fantom
    'stable': '0x686d67265703D1f124c45E33d47d794c566889Ba',
    'stable-ng': '0xe61Fb97Ef6eBFBa12B36Ffd7be785c1F5A2DE66b',
    'twocrypto-ng': '0x4fb93D7d320E8A263F22f62C2059dFC2A8bCbC4c',
    'tricrypto': '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
  },
  42161: { // Arbitrum
    'stable': '0xb17b674D9c5CB2e441F8e196a2f048A81355d031',
    'stable-ng': '0x2191718Cd32D840B3574FB6643ADb7fae346a03C',
    'twocrypto-ng': '0x9c3B46C0Ceb5B9e304FCd6D88Fc50f7DD24B31Bc',
    'tricrypto': '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
  },
  100: { // xDai/Gnosis
    'stable': '0x0BA26e3e1EbCE10032f8E5D9CF13d505F0D36187',
    'stable-ng': '0xbC0797015fcFc47d9C1856639CaE50D0e69FbEE8',
    'twocrypto-ng': '0x3d6cB2F6DcF47CDd9C13E4e3beAe9af041d8796a',
    'tricrypto': '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
  },
  8453: { // Base
    'stable': '0xd2002373543Ce3527023C75e7518C274A51ce712',
    'stable-ng': '0x6A8cbed756804B16E05E741eDaBd5cB544AE21bf',
    'twocrypto-ng': '0xc9Fe0C63Af9A39402e8a5514f9c43Af0322b665F',
    'tricrypto': '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
  },
  56: { // BSC
    'stable': '0xd7D147c6Bb90A718c3De8C0568F9B560C79fa416',
    'stable-ng': '0xd6681e74eEA20d196c15038C580f721EF2aB6320',
    'twocrypto-ng': '0x98EE851a00abeE0d95D08cF4CA2BdCE32aeaAF7F',
    'tricrypto': '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
  },
  43114: { // Avalanche
    'stable': '0xb17b674D9c5CB2e441F8e196a2f048A81355d031',
    'stable-ng': '0x1764ee18e8B3ccA4787249Ceb249356192594585',
    'twocrypto-ng': '0x4A32De8c248533C28904b24B4cFCFE18E9F2ad01',
    'tricrypto': '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
  },
};

const FACTORY_ABI = parseAbi([
  'function pool_count() view returns (uint256)',
  'function pool_list(uint256 index) view returns (address)',
  'function get_lp_token(address pool) view returns (address)',
  'function get_coins(address pool) view returns (address[2])',
  'function get_gauge(address pool) view returns (address)',
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
        logger.debug(`Chain ${this.chainId}: Discovering Curve ${factoryType} factory pools from ${factoryAddress}`);
        const factoryTokens = await this.discoverFromFactory(factoryAddress, factoryType);
        tokens.push(...factoryTokens);
        logger.debug(`Chain ${this.chainId}: Found ${factoryTokens.length} tokens from Curve ${factoryType} factory`);
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
      
      logger.debug(`Chain ${this.chainId}: Curve ${factoryType} factory has ${count} pools`);

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

      logger.debug(`Chain ${this.chainId}: Found ${poolAddresses.length} pools from Curve ${factoryType} factory`);

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

      // Process LP tokens and fetch gauges
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

      // Try to fetch gauges (not all factories have gauges)
      try {
        const gaugeContracts = poolAddresses.map(poolAddress => ({
          address: factoryAddress as Address,
          abi: FACTORY_ABI,
          functionName: 'get_gauge' as const,
          args: [poolAddress],
        }));

        for (let i = 0; i < gaugeContracts.length; i += batchSize) {
          const batch = gaugeContracts.slice(i, i + batchSize);
          const results = await batchReadContracts<Address>(this.chainId, batch);
          
          results.forEach((result) => {
            if (result && result.status === 'success' && result.result) {
              const gauge = result.result;
              if (gauge && gauge !== '0x0000000000000000000000000000000000000000') {
                tokens.push({
                  address: gauge.toLowerCase(),
                  chainId: this.chainId,
                  source: `curve-${factoryType}-gauge`,
                });
              }
            }
          });
        }
      } catch (error) {
        // Gauges might not be available for all factories
        logger.debug(`Gauge fetching not available for ${factoryType} factory`);
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
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.warn(`Error discovering from Curve factory ${factoryAddress}: ${(errorMsg || "Unknown error").substring(0, 100)}`);
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