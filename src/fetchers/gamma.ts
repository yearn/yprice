import axios from 'axios';
import { ERC20Token, Price } from '../models';
import { logger } from '../utils';

interface GammaHypervisor {
  id: string;
  pool: string;
  token0: string;
  token1: string;
  tick: number;
  totalSupply: string;
  tvl0: string;
  tvl1: string;
  tvlUSD: string;
}

interface GammaResponse {
  [key: string]: GammaHypervisor;
}

export class GammaFetcher {
  private readonly apiUrl = 'https://wire2.gamma.xyz/hypervisors/allData';

  async fetchPrices(
    chainId: number,
    tokens: ERC20Token[]
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>();
    
    // Gamma is primarily on these chains
    const supportedChains = [1, 10, 137, 42161, 8453];
    if (!supportedChains.includes(chainId)) {
      return priceMap;
    }

    try {
      logger.debug(`Gamma: Fetching LP prices for chain ${chainId}`);
      
      const response = await axios.get<GammaResponse>(this.apiUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'yearn-pricing-service' },
      });

      if (!response.data) {
        logger.warn(`Gamma API returned no data`);
        return priceMap;
      }

      const tokenAddresses = new Set(tokens.map(t => t.address.toLowerCase()));

      // Process hypervisor data
      for (const [address, hypervisor] of Object.entries(response.data)) {
        const lpAddress = address.toLowerCase();
        
        if (tokenAddresses.has(lpAddress)) {
          // Calculate LP token price from TVL and total supply
          const tvlUSD = parseFloat(hypervisor.tvlUSD || '0');
          const totalSupply = parseFloat(hypervisor.totalSupply || '0');
          
          if (tvlUSD > 0 && totalSupply > 0) {
            // Price per LP token = TVL / Total Supply
            const pricePerToken = tvlUSD / totalSupply;
            
            // Convert to 6 decimal precision
            const price = BigInt(Math.floor(pricePerToken * 1e6));
            
            if (price > BigInt(0)) {
              priceMap.set(lpAddress, {
                address: lpAddress,
                price,
                source: 'gamma',
              });
            }
          }
        }
      }

      logger.debug(`Gamma: Found ${priceMap.size} LP prices for chain ${chainId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`Gamma fetch failed: ${errorMsg}`);
    }

    return priceMap;
  }
}