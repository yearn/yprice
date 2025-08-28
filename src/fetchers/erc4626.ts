import { ethers } from 'ethers';
import { ERC20Token, Price, PriceSource } from '../models';
import { logger } from '../utils';

// ERC4626 Vault ABI - standard methods
const ERC4626_ABI = [
  'function asset() view returns (address)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
];

interface VaultToAsset {
  vaultAddress: string;
  assetAddress: string;
  shareValue: bigint; // How much asset 1e18 shares is worth
}

export class ERC4626Fetcher {
  private providers: Map<number, ethers.Provider> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const rpcUrls: Record<number, string | undefined> = {
      1: process.env.RPC_URI_FOR_1,
      10: process.env.RPC_URI_FOR_10,
      137: process.env.RPC_URI_FOR_137,
      250: process.env.RPC_URI_FOR_250,
      42161: process.env.RPC_URI_FOR_42161,
      100: process.env.RPC_URI_FOR_100,
      8453: process.env.RPC_URI_FOR_8453,
    };

    for (const [chainId, url] of Object.entries(rpcUrls)) {
      if (url) {
        this.providers.set(Number(chainId), new ethers.JsonRpcProvider(url));
      }
    }
  }

  async fetchPrices(
    chainId: number,
    tokens: ERC20Token[],
    underlyingPrices: Map<string, Price>
  ): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>();
    const provider = this.providers.get(chainId);

    if (!provider) {
      return prices;
    }

    // First, get vault to asset mappings
    const vaultMappings = await this.getVaultMappings(provider, tokens);
    
    // Then calculate prices based on underlying asset prices
    for (const mapping of vaultMappings) {
      const assetPrice = underlyingPrices.get(mapping.assetAddress.toLowerCase());
      
      if (assetPrice && assetPrice.price > 0n) {
        // Calculate vault token price
        // vault_price = asset_price * shareValue / 1e18
        const vaultPrice = (assetPrice.price * mapping.shareValue) / BigInt(1e18);
        
        if (vaultPrice > 0n) {
          prices.set(mapping.vaultAddress.toLowerCase(), {
            address: mapping.vaultAddress,
            price: vaultPrice,
            humanizedPrice: Number(vaultPrice) / 1e6,
            source: PriceSource.ERC4626,
          });
        }
      }
    }

    if (prices.size > 0) {
      logger.info(`ERC4626: Calculated ${prices.size} vault prices for chain ${chainId}`);
    }

    return prices;
  }

  private async getVaultMappings(
    provider: ethers.Provider,
    tokens: ERC20Token[]
  ): Promise<VaultToAsset[]> {
    const mappings: VaultToAsset[] = [];
    
    // Process in batches
    const batchSize = 20;
    
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const batchPromises = batch.map(token => this.checkERC4626Vault(provider, token));
      const results = await Promise.all(batchPromises);
      
      for (const result of results) {
        if (result) {
          mappings.push(result);
        }
      }
    }
    
    return mappings;
  }

  private async checkERC4626Vault(
    provider: ethers.Provider,
    token: ERC20Token
  ): Promise<VaultToAsset | null> {
    try {
      const vault = new ethers.Contract(token.address, ERC4626_ABI, provider);
      
      // Check if it's an ERC4626 vault by calling asset()
      const assetFunc = vault['asset'];
      if (!assetFunc) return null;
      
      const assetAddress = await assetFunc();
      
      if (assetAddress && assetAddress !== '0x0000000000000000000000000000000000000000') {
        // Get conversion rate for 1e18 shares
        const convertFunc = vault['convertToAssets'];
        if (convertFunc) {
          try {
            const shareValue = await convertFunc(BigInt(1e18));
            
            return {
              vaultAddress: token.address,
              assetAddress: assetAddress.toLowerCase(),
              shareValue: BigInt(shareValue.toString()),
            };
          } catch {
            // Some vaults might have different implementations
            // Try alternative calculation: totalAssets / totalSupply
            try {
              const totalAssetsFunc = vault['totalAssets'];
              const totalSupplyFunc = vault['totalSupply'];
              
              if (!totalAssetsFunc || !totalSupplyFunc) {
                return null;
              }
              
              const totalAssets = await totalAssetsFunc();
              const totalSupply = await totalSupplyFunc();
              
              if (totalSupply > 0n) {
                const shareValue = (BigInt(totalAssets.toString()) * BigInt(1e18)) / BigInt(totalSupply.toString());
                
                return {
                  vaultAddress: token.address,
                  assetAddress: assetAddress.toLowerCase(),
                  shareValue: shareValue,
                };
              }
            } catch {
              // Vault doesn't support standard methods
            }
          }
        }
      }
    } catch {
      // Not an ERC4626 vault
    }
    
    return null;
  }
}

export default new ERC4626Fetcher();