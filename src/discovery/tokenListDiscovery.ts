import axios from 'axios';
import { ERC20Token } from '../models';
import { logger } from '../utils';

interface TokenListToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId?: number;
}


// Token list URLs by chain
const TOKEN_LISTS: Record<number, { name: string; url: string }[]> = {
  // Ethereum
  1: [
    { name: '1inch', url: 'https://tokens.1inch.io/v1.2/1' },
    { name: 'Uniswap', url: 'https://gateway.ipfs.io/ipns/tokens.uniswap.org' },
  ],
  // Optimism
  10: [
    { name: 'Optimism Official', url: 'https://static.optimism.io/optimism.tokenlist.json' },
    { name: '1inch', url: 'https://tokens.1inch.io/v1.2/10' },
  ],
  // Gnosis
  100: [
    { name: 'Honeyswap', url: 'https://tokens.honeyswap.org' },
    { name: '1inch', url: 'https://tokens.1inch.io/v1.2/100' },
  ],
  // Polygon
  137: [
    { name: 'Polygon Official', url: 'https://api-polygon-tokens.polygon.technology/tokenlists/default.tokenlist.json' },
    { name: '1inch', url: 'https://tokens.1inch.io/v1.2/137' },
  ],
  // Fantom
  250: [
    { name: '1inch', url: 'https://tokens.1inch.io/v1.2/250' },
  ],
  // Base
  8453: [
    { name: '1inch', url: 'https://tokens.1inch.io/v1.2/8453' },
  ],
  // Arbitrum
  42161: [
    { name: 'Arbitrum Bridge', url: 'https://bridge.arbitrum.io/token-list-42161.json' },
    { name: '1inch', url: 'https://tokens.1inch.io/v1.2/42161' },
  ],
};

export class TokenListDiscovery {
  async discoverTokens(chainId: number): Promise<ERC20Token[]> {
    const lists = TOKEN_LISTS[chainId];
    if (!lists || lists.length === 0) {
      return [];
    }

    const allTokens: Map<string, ERC20Token> = new Map();
    
    // Fetch all token lists in parallel
    const promises = lists.map(list => this.fetchTokenList(list.name, list.url, chainId));
    const results = await Promise.allSettled(promises);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        for (const token of result.value) {
          const key = token.address.toLowerCase();
          if (!allTokens.has(key)) {
            allTokens.set(key, token);
          }
        }
      }
    }

    const tokens = Array.from(allTokens.values());
    logger.debug(`Token Lists: Discovered ${tokens.length} tokens for chain ${chainId}`);
    
    return tokens;
  }

  private async fetchTokenList(
    name: string, 
    url: string, 
    chainId: number
  ): Promise<ERC20Token[]> {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; YearnPricing/1.0)',
        },
      });

      const data = response.data;
      let tokens: TokenListToken[] = [];
      
      // Handle different response formats
      if (Array.isArray(data)) {
        // Direct array of tokens (1inch format)
        tokens = data;
      } else if (data.tokens && Array.isArray(data.tokens)) {
        // Standard token list format
        tokens = data.tokens;
      } else if (data.result && Array.isArray(data.result)) {
        // Result wrapper format
        tokens = data.result;
      }

      // Filter and map tokens
      const validTokens = tokens
        .filter(token => {
          // Filter by chainId if specified in token
          if (token.chainId && token.chainId !== chainId) {
            return false;
          }
          // Basic validation
          return token.address && 
                 token.symbol && 
                 token.decimals !== undefined &&
                 token.decimals >= 0 && 
                 token.decimals <= 255;
        })
        .map(token => ({
          address: token.address.toLowerCase(),
          symbol: token.symbol,
          name: token.name || token.symbol,
          decimals: Number(token.decimals),
          chainId: chainId,
        }));

      logger.debug(`Token List ${name}: Found ${validTokens.length} tokens for chain ${chainId}`);
      return validTokens;
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.warn(`Token List ${name} fetch failed for chain ${chainId}: ${(errorMsg || "Unknown error").substring(0, 100)}`);
      return [];
    }
  }
}

export default new TokenListDiscovery();