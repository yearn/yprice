import { ethers } from 'ethers';
import { ERC20Token, Price, PriceSource } from '../models';
import { logger } from '../utils';

// Lens Oracle contract addresses by chain
const LENS_ORACLE_ADDRESSES: Record<number, string> = {
  1: '0x83d95e0D5f402511dB06817Aff3f9eA88224B030', // Ethereum
  10: '0xB082d9f4734c535D9d80536F7E87a6f4F471bF65', // Optimism
  42161: '0x043518AB266485dC085a1DB095B8d9C2Fc78E9b9', // Arbitrum
  250: '0x57AA88A0810dfe3f9b71a9b179Dd8bF5F956C46A', // Fantom
  8453: '0xE0F3D78DB7bC111996864A32d22AB0F59Ca5Fa86', // Base
};

// Lens Oracle ABI - only the methods we need
const LENS_ORACLE_ABI = [
  'function getPriceUsdcRecommended(address token) view returns (uint256)',
  'function getPricesUsdcRecommended(address[] tokens) view returns (uint256[])',
];

export class LensOracleFetcher {
  private providers: Map<number, ethers.Provider> = new Map();
  private oracles: Map<number, ethers.Contract> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Initialize RPC providers and oracle contracts for each chain
    const rpcUrls: Record<number, string | undefined> = {
      1: process.env.RPC_URI_FOR_1,
      10: process.env.RPC_URI_FOR_10,
      42161: process.env.RPC_URI_FOR_42161,
      250: process.env.RPC_URI_FOR_250,
      8453: process.env.RPC_URI_FOR_8453,
    };

    for (const [chainId, url] of Object.entries(rpcUrls)) {
      const chain = Number(chainId);
      const oracleAddress = LENS_ORACLE_ADDRESSES[chain];
      
      if (url && oracleAddress) {
        const provider = new ethers.JsonRpcProvider(url);
        this.providers.set(chain, provider);
        
        const oracle = new ethers.Contract(oracleAddress, LENS_ORACLE_ABI, provider);
        this.oracles.set(chain, oracle);
      }
    }
  }

  async fetchPrices(chainId: number, tokens: ERC20Token[]): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>();
    const oracle = this.oracles.get(chainId);
    
    if (!oracle) {
      // No Lens Oracle on this chain
      return prices;
    }

    // Process in batches to avoid gas limits
    const batchSize = 50;
    
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      
      try {
        // Use batch method if available
        const addresses = batch.map(t => t.address);
        const batchPrices = await this.fetchBatchPrices(oracle, addresses);
        
        for (let j = 0; j < batch.length; j++) {
          const token = batch[j];
          const price = batchPrices[j];
          
          if (!token) continue;
          
          if (price && price > 0n) {
            prices.set(token.address.toLowerCase(), {
              address: token.address,
              price: price,
              humanizedPrice: Number(price) / 1e6,
              source: PriceSource.LENS,
            });
          }
        }
      } catch (error) {
        // If batch fails, try individual queries as fallback
        await this.fetchIndividualPrices(oracle, batch, prices);
      }
    }

    if (prices.size > 0) {
      logger.info(`Lens Oracle: Fetched ${prices.size} prices for chain ${chainId}`);
    }

    return prices;
  }

  private async fetchBatchPrices(oracle: ethers.Contract, addresses: string[]): Promise<bigint[]> {
    try {
      // Try batch method first
      const getPricesBatch = oracle['getPricesUsdcRecommended'];
      if (getPricesBatch) {
        const prices = await getPricesBatch(addresses);
        return prices.map((p: any) => BigInt(p.toString()));
      }
    } catch {
      // Batch method not available or failed
    }

    // Fallback to individual calls
    const prices: bigint[] = [];
    for (const address of addresses) {
      try {
        const getPriceFunc = oracle['getPriceUsdcRecommended'];
        if (!getPriceFunc) {
          prices.push(0n);
          continue;
        }
        const price = await getPriceFunc(address);
        prices.push(BigInt(price.toString()));
      } catch {
        prices.push(0n);
      }
    }
    return prices;
  }

  private async fetchIndividualPrices(
    oracle: ethers.Contract,
    tokens: ERC20Token[],
    prices: Map<string, Price>
  ): Promise<void> {
    for (const token of tokens) {
      try {
        const getPriceFunc = oracle['getPriceUsdcRecommended'];
        if (!getPriceFunc) continue;
        const price = await getPriceFunc(token.address);
        const priceBI = BigInt(price.toString());
        
        if (priceBI > 0n) {
          prices.set(token.address.toLowerCase(), {
            address: token.address,
            price: priceBI,
            humanizedPrice: Number(priceBI) / 1e6,
            source: PriceSource.LENS,
          });
        }
      } catch {
        // Silent fail - token might not have price in oracle
      }
    }
  }
}

export default new LensOracleFetcher();