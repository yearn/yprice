import axios from 'axios';
import { ethers } from 'ethers';
import { TokenInfo } from './types';
import { logger } from '../utils';

interface YearnVault {
  address: string;
  token: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  };
  symbol: string;
  name: string;
  version: string;
}

interface YearnAPIResponse {
  [chainId: string]: YearnVault[];
}

// Yearn vault registry addresses per chain
const REGISTRY_ADDRESSES: Record<number, string> = {
  1: '0x50c1a2eA0a861A967D9d0FFE2AE4012c2E053804', // Ethereum
  10: '0x79286Dd38C9017E5423073bAc11F53357Fc5C128', // Optimism  
  137: '0x32bF3dc86E278F17d6449F88a9d30385106319Dc', // Polygon
  250: '0x727fE1759430df13655ddb0731dE0D0FDE929b04', // Fantom
  42161: '0x3199437193625DCcD6F9C9e98BDf93582200Eb1f', // Arbitrum
};

const VAULT_ABI = [
  'function token() view returns (address)',
  'function asset() view returns (address)', // v3 vaults
  'function numVaults() view returns (uint256)',
  'function vaults(uint256) view returns (address)',
];

export class YearnDiscovery {
  private chainId: number;
  private apiUrl: string = 'https://api.yearn.fi/v1/chains';
  private registryAddress?: string;
  private provider?: ethers.Provider;

  constructor(chainId: number, rpcUrl?: string) {
    this.chainId = chainId;
    this.registryAddress = REGISTRY_ADDRESSES[chainId];
    
    if (rpcUrl && this.registryAddress) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    try {
      // Try API first as it's faster and more complete
      const apiTokens = await this.discoverFromAPI();
      tokens.push(...apiTokens);
      
      // If API fails or returns no results, try on-chain discovery
      if (tokens.length === 0 && this.registryAddress && this.provider) {
        const onChainTokens = await this.discoverFromRegistry();
        tokens.push(...onChainTokens);
      }
    } catch (error) {
      logger.error(`Yearn discovery failed for chain ${this.chainId}:`, error);
    }

    return this.deduplicateTokens(tokens);
  }

  private async discoverFromAPI(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    try {
      const response = await axios.get<YearnAPIResponse>(
        `${this.apiUrl}${this.chainId}/vaults/all`,
        { 
          timeout: 30000,
          headers: { 'User-Agent': 'yearn-pricing-service' }
        }
      );

      const vaults = response.data;
      
      if (Array.isArray(vaults)) {
        for (const vault of vaults) {
          // Add vault token
          tokens.push({
            address: vault.address.toLowerCase(),
            chainId: this.chainId,
            source: 'yearn-vault',
            name: vault.name,
            symbol: vault.symbol,
          });

          // Add underlying token
          if (vault.token?.address && vault.token.address !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: vault.token.address.toLowerCase(),
              chainId: this.chainId,
              source: 'yearn-underlying',
              name: vault.token.name,
              symbol: vault.token.symbol,
              decimals: vault.token.decimals,
            });
          }
        }
      }
    } catch (error: any) {
      logger.warn(`Yearn API fetch failed for chain ${this.chainId}:`, error.message);
    }

    return tokens;
  }

  private async discoverFromRegistry(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    if (!this.provider || !this.registryAddress) {
      return tokens;
    }

    try {
      const registry = new ethers.Contract(
        this.registryAddress,
        VAULT_ABI,
        this.provider
      );

      // Get number of vaults
      const numVaults = await (registry as any).numVaults();
      const vaultCount = Number(numVaults);
      
      logger.info(`Fetching ${vaultCount} Yearn vaults from chain ${this.chainId}`);

      // Batch fetch vault addresses
      const vaultPromises = [];
      for (let i = 0; i < Math.min(vaultCount, 200); i++) { // Limit to prevent too many calls
        vaultPromises.push((registry as any).vaults(i));
      }
      
      const vaultAddresses = await Promise.all(vaultPromises);

      // For each vault, get the underlying token
      for (const vaultAddress of vaultAddresses) {
        // Add vault token
        tokens.push({
          address: vaultAddress.toLowerCase(),
          chainId: this.chainId,
          source: 'yearn-vault',
        });

        // Try to get underlying token
        try {
          const vaultContract = new ethers.Contract(
            vaultAddress,
            VAULT_ABI,
            this.provider
          );
          
          // Try v2 method first
          let underlyingAddress;
          try {
            underlyingAddress = await (vaultContract as any).token();
          } catch {
            // Try v3 method
            try {
              underlyingAddress = await (vaultContract as any).asset();
            } catch {
              // Skip if neither method works
              continue;
            }
          }

          if (underlyingAddress && underlyingAddress !== '0x0000000000000000000000000000000000000000') {
            tokens.push({
              address: underlyingAddress.toLowerCase(),
              chainId: this.chainId,
              source: 'yearn-underlying',
            });
          }
        } catch {
          // Skip vaults we can't query
        }
      }
    } catch (error) {
      logger.error(`Yearn registry discovery failed for chain ${this.chainId}:`, error);
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