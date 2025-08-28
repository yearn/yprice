import { ethers } from 'ethers';
import { ERC20Token, Price, PriceSource } from '../models';
import { logger } from '../utils';

// Curve LP Token ABI for get_virtual_price
const CURVE_LP_TOKEN_ABI = [
  'function get_virtual_price() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
];


export class CurveAmmFetcher {
  private providers: Map<number, ethers.Provider> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Initialize RPC providers for each chain
    const rpcUrls: Record<number, string> = {
      1: process.env.RPC_URI_FOR_1 || 'https://eth.public-rpc.com',
      10: process.env.RPC_URI_FOR_10 || 'https://mainnet.optimism.io',
      137: process.env.RPC_URI_FOR_137 || 'https://polygon-rpc.com',
      250: process.env.RPC_URI_FOR_250 || 'https://rpc.ftm.tools',
      42161: process.env.RPC_URI_FOR_42161 || 'https://arb1.arbitrum.io/rpc',
      100: process.env.RPC_URI_FOR_100 || 'https://rpc.gnosischain.com',
      8453: process.env.RPC_URI_FOR_8453 || 'https://mainnet.base.org',
    };

    for (const [chainId, url] of Object.entries(rpcUrls)) {
      if (url) {
        this.providers.set(Number(chainId), new ethers.JsonRpcProvider(url));
      }
    }
  }

  async fetchPrices(
    chainId: number, 
    tokens: ERC20Token[], 
    _underlyingPrices: Map<string, Price>
  ): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>();
    const provider = this.providers.get(chainId);
    
    if (!provider) {
      logger.warn(`No RPC provider for chain ${chainId} in Curve AMM fetcher`);
      return prices;
    }

    // Process in batches to avoid overwhelming RPC
    const batchSize = 20;
    let processed = 0;
    
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const batchPromises = batch.map(async (token) => {
        try {
          const price = await this.fetchCurveLPPrice(provider, token, _underlyingPrices);
          if (price) {
            prices.set(token.address.toLowerCase(), price);
            return true;
          }
        } catch (error) {
          // Silent fail - not all tokens will be Curve LPs
        }
        return false;
      });
      
      await Promise.all(batchPromises);
      processed += batch.length;
      
      // Log progress for large batches
      if (processed % 100 === 0 && processed > 0) {
        logger.debug(`Curve AMM: Processed ${processed}/${tokens.length} tokens, found ${prices.size} prices`);
      }
    }

    if (prices.size > 0) {
      logger.info(`Curve AMM: Fetched ${prices.size} prices for chain ${chainId}`);
    }

    return prices;
  }

  private async fetchCurveLPPrice(
    provider: ethers.Provider,
    token: ERC20Token,
    _underlyingPrices: Map<string, Price>
  ): Promise<Price | null> {
    try {
      const contract = new ethers.Contract(token.address, CURVE_LP_TOKEN_ABI, provider);
      
      // Try to get virtual price (most Curve LP tokens have this)
      const get_virtual_price = contract['get_virtual_price'];
      if (!get_virtual_price) return null;
      const virtualPrice = await get_virtual_price();
      
      if (virtualPrice && virtualPrice > 0n) {
        // Virtual price is typically in 18 decimals
        // We need to normalize it to 6 decimals for our price format
        const normalizedPrice = this.normalizeVirtualPrice(virtualPrice);
        
        return {
          address: token.address,
          price: normalizedPrice,
          humanizedPrice: Number(normalizedPrice) / 1e6,
          source: PriceSource.CURVE_AMM,
        };
      }
    } catch (error) {
      // Not a Curve LP token or error fetching
    }

    return null;
  }

  private normalizeVirtualPrice(virtualPrice: bigint): bigint {
    // Virtual price is in 18 decimals (price per 1e18 LP tokens)
    // We want price in 6 decimals for compatibility
    // So divide by 10^12 to go from 18 to 6 decimals
    const divisor = BigInt(10) ** BigInt(12);
    return virtualPrice / divisor;
  }
}

export default new CurveAmmFetcher();