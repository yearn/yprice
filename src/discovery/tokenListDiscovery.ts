import axios from 'axios';
import { TokenInfo } from './types';
import { logger } from '../utils';

interface TokenListToken {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

interface TokenList {
  name: string;
  tokens: TokenListToken[];
}

// Popular token list URLs - currently using CHAIN_TOKEN_LISTS below
// const TOKEN_LIST_URLS: Record<string, string> = {
//   'uniswap': 'https://tokens.coingecko.com/uniswap/all.json',
//   'oneInch': 'https://tokens.1inch.io/v1.2/1',
//   'coingecko': 'https://tokens.coingecko.com/ethereum/all.json',
//   'gemini': 'https://www.gemini.com/uniswap/manifest.json',
//   'compound': 'https://raw.githubusercontent.com/compound-finance/token-list/master/compound.tokenlist.json',
//   'aave': 'https://tokenlist.aave.eth.link',
//   'optimism': 'https://static.optimism.io/optimism.tokenlist.json',
//   'arbitrum': 'https://bridge.arbitrum.io/token-list-42161.json',
//   'polygon': 'https://api-polygon-tokens.polygon.technology/tokenlists/default.tokenlist.json',
// };

// Chain-specific token list URLs
const CHAIN_TOKEN_LISTS: Record<number, string[]> = {
  1: [
    'https://tokens.coingecko.com/ethereum/all.json',
    'https://tokens.1inch.io/v1.2/1',
    'https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/mainnet.json',
  ],
  10: [
    'https://static.optimism.io/optimism.tokenlist.json',
    'https://tokens.coingecko.com/optimism/all.json',
  ],
  137: [
    'https://api-polygon-tokens.polygon.technology/tokenlists/default.tokenlist.json',
    'https://tokens.coingecko.com/polygon-pos/all.json',
  ],
  42161: [
    'https://bridge.arbitrum.io/token-list-42161.json',
    'https://tokens.coingecko.com/arbitrum-one/all.json',
  ],
  8453: [
    'https://tokens.coingecko.com/base/all.json',
  ],
  100: [
    'https://tokens.honeyswap.org',
    'https://tokens.coingecko.com/xdai/all.json',
  ],
  250: [
    'https://tokens.coingecko.com/fantom/all.json',
  ],
};

export class TokenListDiscovery {
  private chainId: number;
  private cache: Map<string, TokenList> = new Map();

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    const urls = CHAIN_TOKEN_LISTS[this.chainId] || [];

    for (const url of urls) {
      try {
        const listTokens = await this.fetchTokenList(url);
        tokens.push(...listTokens);
        logger.info(`Chain ${this.chainId}: Loaded ${listTokens.length} tokens from ${url}`);
      } catch (error: any) {
        logger.debug(`Failed to load token list from ${url}:`, error.message);
      }
    }

    // Also try to load CoinGecko comprehensive list
    try {
      const coingeckoTokens = await this.fetchCoinGeckoTokens();
      tokens.push(...coingeckoTokens);
      logger.info(`Chain ${this.chainId}: Loaded ${coingeckoTokens.length} tokens from CoinGecko`);
    } catch (error: any) {
      logger.debug(`Failed to load CoinGecko tokens:`, error.message);
    }

    return this.deduplicateTokens(tokens);
  }

  private async fetchTokenList(url: string): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];

    try {
      // Check cache first
      if (this.cache.has(url)) {
        const cached = this.cache.get(url)!;
        return this.convertTokenList(cached);
      }

      const response = await axios.get<TokenList>(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'yearn-pricing-service' }
      });

      if (response.data?.tokens) {
        this.cache.set(url, response.data);
        return this.convertTokenList(response.data);
      }
    } catch (error) {
      // Try alternative format (some lists return array directly)
      try {
        const response = await axios.get<TokenListToken[]>(url, {
          timeout: 10000,
          headers: { 'User-Agent': 'yearn-pricing-service' }
        });

        if (Array.isArray(response.data)) {
          const tokenList = { name: url, tokens: response.data };
          this.cache.set(url, tokenList);
          return this.convertTokenList(tokenList);
        }
      } catch {
        // Failed both formats
      }
    }

    return tokens;
  }

  private async fetchCoinGeckoTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    // Map chain ID to CoinGecko platform
    const platformMap: Record<number, string> = {
      1: 'ethereum',
      10: 'optimism',
      137: 'polygon-pos',
      250: 'fantom',
      42161: 'arbitrum-one',
      100: 'xdai',
      8453: 'base',
    };

    const platform = platformMap[this.chainId];
    if (!platform) return tokens;

    try {
      const url = `https://tokens.coingecko.com/${platform}/all.json`;
      const response = await axios.get<TokenList>(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'yearn-pricing-service' }
      });

      if (response.data?.tokens) {
        for (const token of response.data.tokens) {
          if (token.chainId === this.chainId) {
            tokens.push({
              address: token.address.toLowerCase(),
              chainId: this.chainId,
              name: token.name,
              symbol: token.symbol,
              decimals: token.decimals,
              source: 'token-list',
            });
          }
        }
      }
    } catch (error: any) {
      // Silently fail, token lists are optional
    }

    return tokens;
  }

  private convertTokenList(tokenList: TokenList): TokenInfo[] {
    const tokens: TokenInfo[] = [];

    for (const token of tokenList.tokens) {
      if (token.chainId === this.chainId) {
        tokens.push({
          address: token.address.toLowerCase(),
          chainId: this.chainId,
          name: token.name,
          symbol: token.symbol,
          decimals: token.decimals,
          source: 'token-list',
        });
      }
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