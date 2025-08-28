import axios from 'axios';
import { TokenInfo } from './types';
import { logger } from '../utils';

// Balancer subgraph endpoints
const BALANCER_SUBGRAPHS: Record<number, string> = {
  1: 'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v2',
  137: 'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-polygon-v2',
  42161: 'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-arbitrum-v2',
  10: 'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-optimism-v2',
  100: 'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-gnosis-chain-v2',
  8453: 'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-base-v2',
  43114: 'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-avalanche-v2',
};

// Balancer API for more comprehensive data
const BALANCER_API_URL = 'https://api.balancer.fi/pools/';

interface BalancerPool {
  id: string;
  address: string;
  poolType: string;
  symbol: string;
  name: string;
  tokens: Array<{
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  }>;
}

interface BalancerSubgraphResponse {
  data: {
    pools: BalancerPool[];
  };
}

export class BalancerDiscovery {
  private chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    // Try subgraph first
    const subgraphTokens = await this.discoverFromSubgraph();
    tokens.push(...subgraphTokens);
    
    // Try API as fallback/supplement
    const apiTokens = await this.discoverFromAPI();
    tokens.push(...apiTokens);

    logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} Balancer tokens total`);
    return this.deduplicateTokens(tokens);
  }

  private async discoverFromSubgraph(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    const subgraphUrl = BALANCER_SUBGRAPHS[this.chainId];
    
    if (!subgraphUrl) {
      return tokens;
    }

    try {
      const query = `
        query {
          pools(first: 1000, orderBy: totalLiquidity, orderDirection: desc) {
            id
            address
            poolType
            symbol
            name
            tokens {
              address
              symbol
              name
              decimals
            }
          }
        }
      `;

      const response = await axios.post<BalancerSubgraphResponse>(
        subgraphUrl,
        { query },
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data?.data?.pools) {
        for (const pool of response.data.data.pools) {
          // Add pool token (BPT - Balancer Pool Token)
          tokens.push({
            address: pool.address.toLowerCase(),
            chainId: this.chainId,
            symbol: pool.symbol,
            name: pool.name,
            source: 'balancer-pool',
          });

          // Add underlying tokens
          for (const token of pool.tokens || []) {
            if (token.address && token.address !== '0x0000000000000000000000000000000000000000') {
              tokens.push({
                address: token.address.toLowerCase(),
                chainId: this.chainId,
                symbol: token.symbol,
                name: token.name,
                decimals: token.decimals,
                source: 'balancer-token',
              });
            }
          }
        }
      }

      logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} tokens from Balancer subgraph`);
    } catch (error: any) {
      logger.warn(`Balancer subgraph discovery failed for chain ${this.chainId}:`, error.message);
    }

    return tokens;
  }

  private async discoverFromAPI(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];

    try {
      // Map chain IDs to Balancer network names
      const networkMap: Record<number, string> = {
        1: 'MAINNET',
        137: 'POLYGON',
        42161: 'ARBITRUM',
        10: 'OPTIMISM',
        100: 'GNOSIS',
        8453: 'BASE',
        43114: 'AVALANCHE',
      };

      const network = networkMap[this.chainId];
      if (!network) {
        return tokens;
      }

      const response = await axios.get(`${BALANCER_API_URL}${this.chainId}`, {
        timeout: 30000,
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.data && Array.isArray(response.data)) {
        for (const pool of response.data) {
          // Add pool token
          if (pool.address) {
            tokens.push({
              address: pool.address.toLowerCase(),
              chainId: this.chainId,
              symbol: pool.symbol,
              name: pool.name,
              source: 'balancer-api-pool',
            });
          }

          // Add pool tokens
          for (const token of pool.poolTokens || []) {
            if (token.address && token.address !== '0x0000000000000000000000000000000000000000') {
              tokens.push({
                address: token.address.toLowerCase(),
                chainId: this.chainId,
                symbol: token.symbol,
                name: token.name,
                source: 'balancer-api-token',
              });
            }
          }
        }
      }

      logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} tokens from Balancer API`);
    } catch (error: any) {
      // API might not be available for all chains
      logger.debug(`Balancer API discovery failed for chain ${this.chainId}:`, error.message);
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