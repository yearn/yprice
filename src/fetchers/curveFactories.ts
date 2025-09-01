import axios from 'axios';
import { ERC20Token, Price } from '../models';
import { logger } from '../utils';
import { getPriceStorage } from '../storage';

interface CurvePoolData {
  id: string;
  address: string;
  lpTokenAddress?: string;
  totalSupply?: string;
  virtualPrice?: string;
  usdTotal?: number;
  coins: Array<{
    address: string;
    symbol: string;
    decimals: number;
    usdPrice?: number;
  }>;
}

interface CurveAPIResponse {
  success: boolean;
  data: {
    poolData: CurvePoolData[];
  };
}

// Curve API endpoints by chain
const CURVE_API_URLS: Record<number, string> = {
  1: 'https://api.curve.fi/api/getPools/ethereum/main',
  10: 'https://api.curve.fi/api/getPools/optimism/main',
  137: 'https://api.curve.fi/api/getPools/polygon/main',
  250: 'https://api.curve.fi/api/getPools/fantom/main',
  42161: 'https://api.curve.fi/api/getPools/arbitrum/main',
};

export class CurveFactoriesFetcher {
  async fetchPrices(
    chainId: number,
    tokens: ERC20Token[]
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>();
    const apiUrl = CURVE_API_URLS[chainId];

    if (!apiUrl) {
      return priceMap;
    }

    try {
      logger.debug(`Curve Factories: Fetching prices for chain ${chainId}`);
      
      const response = await axios.get<CurveAPIResponse>(apiUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'yearn-pricing-service' },
      });

      if (!response.data?.success || !response.data?.data?.poolData) {
        logger.warn(`Curve Factories API returned no data for chain ${chainId}`);
        return priceMap;
      }

      const tokenAddresses = new Set(tokens.map(t => t.address.toLowerCase()));
      const poolData = response.data.data.poolData;

      // Create a map of token prices from coin data
      const coinPrices = new Map<string, number>();
      for (const pool of poolData) {
        for (const coin of pool.coins || []) {
          if (coin.address && coin.usdPrice) {
            coinPrices.set(coin.address.toLowerCase(), coin.usdPrice);
          }
        }
      }

      // Map LP token prices
      for (const pool of poolData) {
        const lpAddress = (pool.lpTokenAddress || pool.address || '').toLowerCase();
        
        if (lpAddress && tokenAddresses.has(lpAddress)) {
          // Calculate LP token price from pool data
          if (pool.usdTotal && pool.totalSupply) {
            const totalSupply = parseFloat(pool.totalSupply);
            if (totalSupply > 0) {
              const priceUsd = pool.usdTotal / totalSupply;
              
              // Convert to 6 decimal precision (matching DeFiLlama format)
              const price = BigInt(Math.floor(priceUsd * 1e6));
              
              if (price > BigInt(0)) {
                priceMap.set(lpAddress, {
                  address: lpAddress,
                  price,
                  source: 'curve-factories',
                });
              }
            }
          } else if (pool.virtualPrice) {
            // Fallback to virtual price calculation
            const virtualPrice = parseFloat(pool.virtualPrice);
            const price = BigInt(Math.floor(virtualPrice * 1e6));
            
            if (price > BigInt(0)) {
              priceMap.set(lpAddress, {
                address: lpAddress,
                price,
                source: 'curve-factories',
              });
            }
          }
        }
      }

      // Map coin prices for tokens we're looking for
      for (const token of tokens) {
        const address = token.address.toLowerCase();
        if (!priceMap.has(address) && coinPrices.has(address)) {
          const priceUsd = coinPrices.get(address)!;
          const price = BigInt(Math.floor(priceUsd * 1e6));
          
          if (price > BigInt(0)) {
            priceMap.set(address, {
              address,
              price,
              source: 'curve-factories',
            });
          }
        }
      }

      logger.debug(`Curve Factories: Found ${priceMap.size} prices for chain ${chainId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`Curve Factories fetch failed for chain ${chainId}: ${errorMsg}`);
    }

    return priceMap;
  }
}