import axios from 'axios';
import { TokenInfo } from './types';
import { logger } from '../utils';

interface PendleAsset {
  id: string;
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  expiry?: string;
  pt?: {
    address: string;
    symbol: string;
  };
  yt?: {
    address: string;
    symbol: string;
  };
  sy?: {
    address: string;
    symbol: string;
  };
  underlyingAsset?: {
    address: string;
    symbol: string;
  };
}

interface PendleResponse {
  results: PendleAsset[];
}

// Pendle API endpoints per chain
const PENDLE_API_URLS: Record<number, string> = {
  1: 'https://api-v2.pendle.finance/core/v1/1/assets/all',
  42161: 'https://api-v2.pendle.finance/core/v1/42161/assets/all',
  8453: 'https://api-v2.pendle.finance/core/v1/8453/assets/all',
  10: 'https://api-v2.pendle.finance/core/v1/10/assets/all',
  // Pendle might expand to other chains
};

export class PendleDiscovery {
  private chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    const apiUrl = PENDLE_API_URLS[this.chainId];

    if (!apiUrl) {
      return tokens; // No Pendle on this chain
    }

    try {
      const response = await axios.get<PendleResponse>(apiUrl, {
        timeout: 30000,
        headers: { 
          'User-Agent': 'yearn-pricing-service',
          'Accept': 'application/json'
        }
      });

      if (response.data?.results) {
        for (const asset of response.data.results) {
          // Add main asset
          tokens.push({
            address: asset.address.toLowerCase(),
            chainId: this.chainId,
            name: asset.name,
            symbol: asset.symbol,
            decimals: asset.decimals,
            source: 'pendle-asset',
          });

          // Add PT (Principal Token) if exists
          if (asset.pt?.address && asset.pt.address !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: asset.pt.address.toLowerCase(),
              chainId: this.chainId,
              symbol: asset.pt.symbol,
              source: 'pendle-pt',
            });
          }

          // Add YT (Yield Token) if exists
          if (asset.yt?.address && asset.yt.address !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: asset.yt.address.toLowerCase(),
              chainId: this.chainId,
              symbol: asset.yt.symbol,
              source: 'pendle-yt',
            });
          }

          // Add SY (Standardized Yield) token if exists
          if (asset.sy?.address && asset.sy.address !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: asset.sy.address.toLowerCase(),
              chainId: this.chainId,
              symbol: asset.sy.symbol,
              source: 'pendle-sy',
            });
          }

          // Add underlying asset if exists
          if (asset.underlyingAsset?.address && 
              asset.underlyingAsset.address !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: asset.underlyingAsset.address.toLowerCase(),
              chainId: this.chainId,
              symbol: asset.underlyingAsset.symbol,
              source: 'pendle-underlying',
            });
          }
        }
      }

      logger.info(`Chain ${this.chainId}: Discovered ${tokens.length} Pendle tokens`);
    } catch (error: any) {
      logger.warn(`Pendle discovery failed for chain ${this.chainId}:`, error.message);
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