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
    { name: 'CoinGecko', url: 'https://tokens.coingecko.com/ethereum/all.json' },
    { name: '1inch', url: 'https://tokens.1inch.io/v1.2/1' },
    { name: 'Uniswap', url: 'https://gateway.ipfs.io/ipns/tokens.uniswap.org' },
  ],
  // Optimism
  10: [
    { name: 'Optimism Official', url: 'https://static.optimism.io/optimism.tokenlist.json' },
    { name: 'CoinGecko', url: 'https://tokens.coingecko.com/optimism/all.json' },
  ],
  // Gnosis
  100: [
    { name: 'CoinGecko', url: 'https://tokens.coingecko.com/xdai/all.json' },
    { name: 'Honeyswap', url: 'https://tokens.honeyswap.org' },
  ],
  // Polygon
  137: [
    { name: 'Polygon Official', url: 'https://api-polygon-tokens.polygon.technology/tokenlists/default.tokenlist.json' },
    { name: 'CoinGecko', url: 'https://tokens.coingecko.com/polygon-pos/all.json' },
  ],
  // Fantom
  250: [
    { name: 'CoinGecko', url: 'https://tokens.coingecko.com/fantom/all.json' },
  ],
  // Base
  8453: [
    { name: 'CoinGecko', url: 'https://tokens.coingecko.com/base/all.json' },
  ],
  // Arbitrum
  42161: [
    { name: 'Arbitrum Bridge', url: 'https://bridge.arbitrum.io/token-list-42161.json' },
    { name: 'CoinGecko', url: 'https://tokens.coingecko.com/arbitrum-one/all.json' },
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
    logger.info(`Token Lists: Discovered ${tokens.length} tokens for chain ${chainId}`);
    
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

      logger.info(`Token List ${name}: Found ${validTokens.length} tokens for chain ${chainId}`);
      return validTokens;
      
    } catch (error) {
      logger.error(`Token List ${name} fetch failed for chain ${chainId}:`, error);
      return [];
    }
  }
}

export default new TokenListDiscovery();