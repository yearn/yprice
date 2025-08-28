import axios from 'axios';
import { parseAbi, type Address } from 'viem';
import { TokenInfo } from './types';
import { logger, getPublicClient, batchReadContracts } from '../utils';

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

const REGISTRY_ABI = parseAbi([
  'function numVaults() view returns (uint256)',
  'function vaults(uint256 index) view returns (address)',
]);

const VAULT_ABI = parseAbi([
  'function token() view returns (address)',
  'function asset() view returns (address)', // v3 vaults
]);

export class YearnDiscovery {
  private chainId: number;
  private apiUrl: string = 'https://api.yearn.fi/v1/chains';
  private registryAddress?: string;

  constructor(chainId: number, _rpcUrl?: string) {
    this.chainId = chainId;
    this.registryAddress = REGISTRY_ADDRESSES[chainId];
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    try {
      // Try API first as it's faster and more complete
      const apiTokens = await this.discoverFromAPI();
      tokens.push(...apiTokens);
      
      // If API fails or returns no results, try on-chain discovery
      if (tokens.length === 0 && this.registryAddress) {
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
    
    if (!this.registryAddress) {
      return tokens;
    }

    const publicClient = getPublicClient(this.chainId);

    try {
      // Get number of vaults
      const numVaults = await publicClient.readContract({
        address: this.registryAddress as Address,
        abi: REGISTRY_ABI,
        functionName: 'numVaults',
      }) as bigint;
      const vaultCount = Number(numVaults);
      
      logger.info(`Fetching ${vaultCount} Yearn vaults from chain ${this.chainId}`);

      // Batch fetch vault addresses using multicall
      const vaultIndexContracts = [];
      for (let i = 0; i < Math.min(vaultCount, 200); i++) { // Limit to prevent too many calls
        vaultIndexContracts.push({
          address: this.registryAddress as Address,
          abi: REGISTRY_ABI,
          functionName: 'vaults' as const,
          args: [BigInt(i)],
        });
      }
      
      const vaultAddressResults = await batchReadContracts<Address>(this.chainId, vaultIndexContracts);
      const vaultAddresses: Address[] = [];
      
      vaultAddressResults.forEach((result) => {
        if (result && result.status === 'success' && result.result) {
          vaultAddresses.push(result.result);
        }
      });

      // Add all vault tokens
      for (const vaultAddress of vaultAddresses) {
        tokens.push({
          address: vaultAddress.toLowerCase(),
          chainId: this.chainId,
          source: 'yearn-vault',
        });
      }

      // Batch fetch underlying tokens - try v2 method first
      const v2TokenContracts = vaultAddresses.map(vaultAddress => ({
        address: vaultAddress as Address,
        abi: VAULT_ABI,
        functionName: 'token' as const,
        args: [],
      }));

      const v2TokenResults = await batchReadContracts<Address>(this.chainId, v2TokenContracts);
      
      // For vaults where v2 failed, try v3 method
      const v3VaultAddresses: Address[] = [];
      vaultAddresses.forEach((vaultAddress, index) => {
        const result = v2TokenResults[index];
        if (!result || result.status !== 'success' || !result.result) {
          v3VaultAddresses.push(vaultAddress);
        } else if (result.result && result.result !== '0x0000000000000000000000000000000000000000') {
          tokens.push({
            address: result.result.toLowerCase(),
            chainId: this.chainId,
            source: 'yearn-underlying',
          });
        }
      });

      // Try v3 method for remaining vaults
      if (v3VaultAddresses.length > 0) {
        const v3AssetContracts = v3VaultAddresses.map(vaultAddress => ({
          address: vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: 'asset' as const,
          args: [],
        }));

        const v3AssetResults = await batchReadContracts<Address>(this.chainId, v3AssetContracts);
        
        v3AssetResults.forEach((result) => {
          if (result && result.status === 'success' && result.result) {
            const underlyingAddress = result.result;
            if (underlyingAddress && underlyingAddress !== '0x0000000000000000000000000000000000000000') {
              tokens.push({
                address: underlyingAddress.toLowerCase(),
                chainId: this.chainId,
                source: 'yearn-underlying',
              });
            }
          }
        });
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