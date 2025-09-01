import axios from 'axios';
import { parseAbi, zeroAddress, type Address } from 'viem';
import { TokenInfo } from './types';
import { logger, getPublicClient, batchReadContracts, discoveryPriceCache } from '../utils';
import { uniqBy } from 'lodash';

interface KongVault {
  address: string;
  pricePerShare: string;
  token: string;  // This is the token address as a string
  asset?: {
    address: string;
    name?: string;
    symbol?: string;
    decimals?: number;
  };
}

interface KongGraphQLResponse {
  data: {
    vaults: KongVault[];
  };
}

const REGISTRY_ADDRESSES: Record<number, string> = {
  1: '0x50c1a2eA0a861A967D9d0FFE2AE4012c2E053804',
  10: '0x79286Dd38C9017E5423073bAc11F53357Fc5C128',  
  137: '0x32bF3dc86E278F17D6449f88A9d30385106319Dc',
  250: '0x727fe1759430df13655ddb0731dE0D0FDE929b04',
  42161: '0x3199437193625DCcD6F9C9e98BDf93582200Eb1f',
};

const REGISTRY_ABI = parseAbi([
  'function numVaults() view returns (uint256)',
  'function vaults(uint256 index) view returns (address)',
]);

const VAULT_ABI = parseAbi([
  'function token() view returns (address)',
  'function asset() view returns (address)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

export class YearnDiscovery {
  private chainId: number;
  private kongUrl: string = 'https://kong.yearn.farm/api/gql';
  private registryAddress?: string;

  constructor(chainId: number, _rpcUrl?: string) {
    this.chainId = chainId;
    this.registryAddress = REGISTRY_ADDRESSES[chainId];
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    try {
      const kongTokens = await this.discoverFromKong();
      tokens.push(...kongTokens);
      
      if (tokens.length === 0 && this.registryAddress) {
        const onChainTokens = await this.discoverFromRegistry();
        tokens.push(...onChainTokens);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.warn(`Yearn discovery failed for chain ${this.chainId}: ${(errorMsg || "Unknown error").substring(0, 100)}`);
    }

    return uniqBy(tokens, token => `${token.chainId}-${token.address.toLowerCase()}`);
  }

  private async discoverFromKong(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];
    
    try {
      const query = `
        query GetVaults {
          vaults(chainId: ${this.chainId}) {
            address
            pricePerShare
            token
            asset {
              address
              name
              symbol
              decimals
            }
          }
        }
      `;

      const response = await axios.post<KongGraphQLResponse>(
        this.kongUrl,
        { query },
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'yearn-pricing-service'
          }
        }
      );

      const vaults = response.data?.data?.vaults;
      
      if (Array.isArray(vaults)) {
        logger.debug(`Kong API returned ${vaults.length} vaults for chain ${this.chainId}`);
        
        for (const vault of vaults) {
          // Add vault token
          if (vault.address) {
            tokens.push({
              address: vault.address.toLowerCase(),
              chainId: this.chainId,
              source: 'yearn-vault',
            });
            
            // Cache pricePerShare data for the vault
            if (vault.pricePerShare) {
              const pricePerShare = BigInt(vault.pricePerShare);
              const underlyingAddress = vault.asset?.address || vault.token;
              
              discoveryPriceCache.set(this.chainId, vault.address, undefined, 'yearn-vault', {
                pricePerShare,
                underlyingAddress: underlyingAddress?.toLowerCase(),
              });
            }
          }

          // Add underlying token (from asset field for v3 or token field for v2)
          const tokenAddress = vault.asset?.address || vault.token;
          if (tokenAddress && tokenAddress !== zeroAddress) {
            tokens.push({
              address: tokenAddress.toLowerCase(),
              chainId: this.chainId,
              source: 'yearn-underlying',
              name: vault.asset?.name,
              symbol: vault.asset?.symbol,
              decimals: vault.asset?.decimals,
            });
          }
        }

        // If Kong didn't return token info, fetch it on-chain
        const vaultsWithoutTokenInfo = vaults.filter(v => !v.asset?.address && !v.token && v.address);
        if (vaultsWithoutTokenInfo.length > 0) {
          const underlyingTokens = await this.fetchUnderlyingTokens(
            vaultsWithoutTokenInfo.map(v => v.address as Address)
          );
          tokens.push(...underlyingTokens);
        }
      }
    } catch (error: any) {
      logger.warn(`Kong GraphQL fetch failed for chain ${this.chainId}: ${error.message || 'Unknown error'}`);
    }

    return tokens;
  }

  private async fetchUnderlyingTokens(vaultAddresses: Address[]): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];

    try {
      const tokenContracts = vaultAddresses.map(vaultAddress => ({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'token' as const,
        args: [],
      }));

      const tokenResults = await batchReadContracts<Address>(this.chainId, tokenContracts);
      
      const v3VaultAddresses: Address[] = [];
      vaultAddresses.forEach((vaultAddress, index) => {
        const result = tokenResults[index];
        if (!result || result.status !== 'success' || !result.result) {
          v3VaultAddresses.push(vaultAddress);
        } else if (result.result && result.result !== zeroAddress) {
          tokens.push({
            address: result.result.toLowerCase(),
            chainId: this.chainId,
            source: 'yearn-underlying',
          });
        }
      });

      if (v3VaultAddresses.length > 0) {
        const v3AssetContracts = v3VaultAddresses.map(vaultAddress => ({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: 'asset' as const,
          args: [],
        }));

        const v3AssetResults = await batchReadContracts<Address>(this.chainId, v3AssetContracts);
        
        v3AssetResults.forEach((result) => {
          if (result && result.status === 'success' && result.result) {
            const underlyingAddress = result.result;
            if (underlyingAddress && underlyingAddress !== zeroAddress) {
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
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.warn(`Failed to fetch underlying tokens for chain ${this.chainId}: ${(errorMsg || "Unknown error").substring(0, 100)}`);
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
      const numVaults = await publicClient.readContract({
        address: this.registryAddress as Address,
        abi: REGISTRY_ABI,
        functionName: 'numVaults',
      }) as bigint;
      const vaultCount = Number(numVaults);
      
      logger.debug(`Fetching ${vaultCount} Yearn vaults from registry on chain ${this.chainId}`);

      const vaultIndexContracts = [];
      for (let i = 0; i < Math.min(vaultCount, 200); i++) {
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

      for (const vaultAddress of vaultAddresses) {
        tokens.push({
          address: vaultAddress.toLowerCase(),
          chainId: this.chainId,
          source: 'yearn-vault',
        });
      }

      const underlyingTokens = await this.fetchUnderlyingTokens(vaultAddresses);
      tokens.push(...underlyingTokens);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      logger.warn(`Yearn registry discovery failed for chain ${this.chainId}: ${(errorMsg || "Unknown error").substring(0, 100)}`);
    }

    return tokens;
  }
}