import axios from 'axios';
import https from 'https';
import { TokenInfo } from './types';
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

// Gamma API endpoints - same endpoint for all chains
const GAMMA_API_URLS: Record<number, string> = {
  1: 'https://wire2.gamma.xyz/hypervisors/allData',
  10: 'https://wire2.gamma.xyz/hypervisors/allData',
  137: 'https://wire2.gamma.xyz/hypervisors/allData',
  42161: 'https://wire2.gamma.xyz/hypervisors/allData',
  8453: 'https://wire2.gamma.xyz/hypervisors/allData',
  // Note: Gnosis (100) and Fantom (250) might not have Gamma deployments
};

export class GammaDiscovery {
  private chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    const apiUrl = GAMMA_API_URLS[this.chainId];

    if (!apiUrl) {
      return tokens; // No Gamma on this chain
    }

    try {
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false // Temporarily disable SSL verification
      });
      
      const response = await axios.get<GammaResponse>(apiUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'yearn-pricing-service' },
        httpsAgent: httpsAgent
      });

      if (response.data) {
        for (const [address, hypervisor] of Object.entries(response.data)) {
          // Add hypervisor LP token
          tokens.push({
            address: address.toLowerCase(),
            chainId: this.chainId,
            source: 'gamma-lp',
          });

          // Add token0
          if (hypervisor.token0 && hypervisor.token0 !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: hypervisor.token0.toLowerCase(),
              chainId: this.chainId,
              source: 'gamma-token',
            });
          }

          // Add token1
          if (hypervisor.token1 && hypervisor.token1 !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: hypervisor.token1.toLowerCase(),
              chainId: this.chainId,
              source: 'gamma-token',
            });
          }

          // Also add the pool address if it exists
          if (hypervisor.pool && hypervisor.pool !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: hypervisor.pool.toLowerCase(),
              chainId: this.chainId,
              source: 'gamma-pool',
            });
          }
        }
      }

      logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} Gamma tokens`);
    } catch (error: any) {
      logger.warn(`Gamma discovery failed for chain ${this.chainId}:`, error.message);
    }

    return this.deduplicateTokens(tokens);
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