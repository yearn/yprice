import { ethers } from 'ethers';
import { ERC20Token, Price, PriceSource } from '../models';
import { logger } from '../utils';

// Yearn Vault V2 ABI - methods for price calculation
const YEARN_VAULT_ABI = [
  'function token() view returns (address)',
  'function pricePerShare() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  // V3 specific
  'function asset() view returns (address)',
  'function convertToAssets(uint256) view returns (uint256)',
];

interface VaultInfo {
  vaultAddress: string;
  tokenAddress: string;
  pricePerShare: bigint;
  decimals: number;
}

export class YearnVaultFetcher {
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

    // Get vault information
    const vaultInfos = await this.getVaultInfos(provider, tokens);
    
    // Calculate prices based on underlying token prices
    for (const vaultInfo of vaultInfos) {
      const tokenPrice = underlyingPrices.get(vaultInfo.tokenAddress.toLowerCase());
      
      if (tokenPrice && tokenPrice.price > 0n) {
        // Calculate vault price
        // For V2: price = tokenPrice * pricePerShare / 10^decimals
        const decimalsMultiplier = BigInt(10) ** BigInt(vaultInfo.decimals);
        const vaultPrice = (tokenPrice.price * vaultInfo.pricePerShare) / decimalsMultiplier;
        
        if (vaultPrice > 0n) {
          prices.set(vaultInfo.vaultAddress.toLowerCase(), {
            address: vaultInfo.vaultAddress,
            price: vaultPrice,
            humanizedPrice: Number(vaultPrice) / 1e6,
            source: PriceSource.VAULT_V2,
          });
        }
      }
    }

    if (prices.size > 0) {
      logger.info(`Yearn Vault: Calculated ${prices.size} vault prices for chain ${chainId}`);
    }

    return prices;
  }

  private async getVaultInfos(
    provider: ethers.Provider,
    tokens: ERC20Token[]
  ): Promise<VaultInfo[]> {
    const vaultInfos: VaultInfo[] = [];
    
    // Filter for potential Yearn vaults (usually have yv prefix or contain vault/Vault)
    const potentialVaults = tokens.filter(t => 
      t.symbol?.startsWith('yv') ||
      t.symbol?.startsWith('yvCurve') ||
      t.symbol?.startsWith('yvBoost') ||
      t.name?.toLowerCase().includes('vault') ||
      t.symbol?.includes('yVault')
    );
    
    // Process in batches
    const batchSize = 10;
    
    for (let i = 0; i < potentialVaults.length; i += batchSize) {
      const batch = potentialVaults.slice(i, i + batchSize);
      const batchPromises = batch.map(token => this.checkYearnVault(provider, token));
      const results = await Promise.all(batchPromises);
      
      for (const result of results) {
        if (result) {
          vaultInfos.push(result);
        }
      }
    }
    
    return vaultInfos;
  }

  private async checkYearnVault(
    provider: ethers.Provider,
    token: ERC20Token
  ): Promise<VaultInfo | null> {
    try {
      const vault = new ethers.Contract(token.address, YEARN_VAULT_ABI, provider);
      
      // Try V2 methods first (token + pricePerShare)
      try {
        const tokenFunc = vault['token'];
        const ppsFunc = vault['pricePerShare'];
        
        if (tokenFunc && ppsFunc) {
          const tokenAddress = await tokenFunc();
          const pricePerShare = await ppsFunc();
          
          if (tokenAddress && tokenAddress !== '0x0000000000000000000000000000000000000000') {
            // Get decimals (default to 18 if not available)
            let decimals = 18;
            try {
              const decimalsFunc = vault['decimals'];
              if (decimalsFunc) {
                decimals = Number(await decimalsFunc());
              }
            } catch {
              // Use default
            }
            
            return {
              vaultAddress: token.address,
              tokenAddress: tokenAddress.toLowerCase(),
              pricePerShare: BigInt(pricePerShare.toString()),
              decimals: decimals,
            };
          }
        }
      } catch {
        // Not a V2 vault, try V3/ERC4626 methods
      }
      
      // Try V3/ERC4626 methods (asset + convertToAssets)
      try {
        const assetFunc = vault['asset'];
        const convertFunc = vault['convertToAssets'];
        
        if (assetFunc && convertFunc) {
          const assetAddress = await assetFunc();
          
          if (assetAddress && assetAddress !== '0x0000000000000000000000000000000000000000') {
            // Get conversion rate for 1e18 shares
            const shareValue = await convertFunc(BigInt(1e18));
            
            return {
              vaultAddress: token.address,
              tokenAddress: assetAddress.toLowerCase(),
              pricePerShare: BigInt(shareValue.toString()),
              decimals: 18, // V3 uses 18 decimals
            };
          }
        }
      } catch {
        // Not a V3 vault either
      }
      
      // Last resort: try totalAssets / totalSupply
      try {
        const tokenFunc = vault['token'] || vault['asset'];
        const totalAssetsFunc = vault['totalAssets'];
        const totalSupplyFunc = vault['totalSupply'];
        const decimalsFunc = vault['decimals'];
        
        if (tokenFunc && totalAssetsFunc && totalSupplyFunc) {
          const tokenAddress = await tokenFunc();
          const totalAssets = await totalAssetsFunc();
          const totalSupply = await totalSupplyFunc();
          
          if (tokenAddress && totalSupply > 0n) {
            let decimals = 18;
            try {
              if (decimalsFunc) {
                decimals = Number(await decimalsFunc());
              }
            } catch {
              // Use default
            }
            
            const pricePerShare = (BigInt(totalAssets.toString()) * BigInt(10) ** BigInt(decimals)) / BigInt(totalSupply.toString());
            
            return {
              vaultAddress: token.address,
              tokenAddress: tokenAddress.toLowerCase(),
              pricePerShare: pricePerShare,
              decimals: decimals,
            };
          }
        }
      } catch {
        // Not a vault we can handle
      }
    } catch {
      // Not a Yearn vault
    }
    
    return null;
  }
}

export default new YearnVaultFetcher();