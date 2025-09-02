import { parseAbi, type Address } from 'viem';
import { ERC20Token, Price } from '../models';
import { logger, batchReadContracts, discoveryPriceCache } from '../utils';

// Yearn Vault V2 ABI
const YEARN_VAULT_V2_ABI = parseAbi([
  'function pricePerShare() view returns (uint256)',
  'function token() view returns (address)',
  'function decimals() view returns (uint8)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]);

// Yearn Vault V3 ABI (ERC4626 compliant)
const YEARN_VAULT_V3_ABI = parseAbi([
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function asset() view returns (address)',
  'function pricePerShare() view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

export class YearnVaultFetcher {
  async fetchPrices(
    chainId: number,
    tokens: ERC20Token[],
    underlyingPrices: Map<string, Price>
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>();

    try {

      // Filter for Yearn vaults - check source first, then fallback to name/symbol patterns
      const yearnVaults = tokens.filter(token => {
        if (token.source === 'yearn-vault') {
          return true;
        }
        
        // Fallback: check name/symbol patterns
        const symbol = token.symbol?.toLowerCase() || '';
        const name = token.name?.toLowerCase() || '';
        return (
          symbol.startsWith('yv') ||
          symbol.startsWith('vy') ||
          name.includes('yearn') ||
          (name.includes('vault') && name.includes('yfi'))
        );
      });

      if (yearnVaults.length === 0) {
        return priceMap;
      }

      logger.info(`Yearn Vault: Checking ${yearnVaults.length} potential vaults on chain ${chainId} (from ${tokens.length} total tokens)`);

      // First check cached data from discovery
      const vaultsWithData: { vault: ERC20Token; underlying: string; pricePerShare: bigint }[] = [];
      const vaultsNeedingOnChain: ERC20Token[] = [];
      
      yearnVaults.forEach(vault => {
        const cached = discoveryPriceCache.get(chainId, vault.address);
        if (cached?.data?.pricePerShare && cached?.data?.underlyingAddress) {
          vaultsWithData.push({
            vault,
            underlying: cached.data.underlyingAddress,
            pricePerShare: cached.data.pricePerShare,
          });
        } else {
          vaultsNeedingOnChain.push(vault);
        }
      });
      
      if (vaultsWithData.length > 0) {
        logger.info(`Yearn Vault: Using ${vaultsWithData.length} cached pricePerShare values`);
        // Log specific vaults
        vaultsWithData.forEach(({ vault, underlying, pricePerShare }) => {
          if (vault.address.toLowerCase() === '0x028ec7330ff87667b6dfb0d94b954c820195336c' ||
              vault.address.toLowerCase() === '0x182863131f9a4630ff9e27830d945b1413e347e8') {
            logger.info(`Processing vault ${vault.address}: underlying=${underlying}, pricePerShare=${pricePerShare}`);
          }
        });
      }
      
      // For vaults without cached data, fetch on-chain
      if (vaultsNeedingOnChain.length > 0) {
        // Try V2 method: pricePerShare()
        const v2PriceContracts = vaultsNeedingOnChain.map(vault => ({
          address: vault.address as Address,
          abi: YEARN_VAULT_V2_ABI,
          functionName: 'pricePerShare' as const,
          args: [],
        }));

        const v2PriceResults = await batchReadContracts<bigint>(chainId, v2PriceContracts);

        // Also get underlying token addresses
        const tokenContracts = vaultsNeedingOnChain.map(vault => ({
          address: vault.address as Address,
          abi: YEARN_VAULT_V2_ABI,
          functionName: 'token' as const,
          args: [],
        }));

        const tokenResults = await batchReadContracts<Address>(chainId, tokenContracts);
        
        vaultsNeedingOnChain.forEach((vault, index) => {
          const priceResult = v2PriceResults[index];
          const tokenResult = tokenResults[index];
          
          if (
            priceResult && priceResult.status === 'success' && priceResult.result &&
            tokenResult && tokenResult.status === 'success' && tokenResult.result
          ) {
            vaultsWithData.push({
              vault,
              underlying: tokenResult.result.toLowerCase(),
              pricePerShare: priceResult.result,
            });
          }
        });
      }

      // Try V3 method for vaults that didn't work with V2 or cache
      const v3Vaults = vaultsNeedingOnChain.filter(
        vault => !vaultsWithData.find(v => v.vault.address === vault.address)
      );

      if (v3Vaults.length > 0) {
        // For V3, use convertToAssets(1e18)
        const v3ConvertContracts = v3Vaults.map(vault => ({
          address: vault.address as Address,
          abi: YEARN_VAULT_V3_ABI,
          functionName: 'convertToAssets' as const,
          args: [BigInt(10 ** 18)], // 1e18 shares
        }));

        const v3ConvertResults = await batchReadContracts<bigint>(chainId, v3ConvertContracts);

        // Get asset addresses for V3
        const v3AssetContracts = v3Vaults.map(vault => ({
          address: vault.address as Address,
          abi: YEARN_VAULT_V3_ABI,
          functionName: 'asset' as const,
          args: [],
        }));

        const v3AssetResults = await batchReadContracts<Address>(chainId, v3AssetContracts);

        // Process V3 vaults
        v3Vaults.forEach((vault, index) => {
          const convertResult = v3ConvertResults[index];
          const assetResult = v3AssetResults[index];
          
          if (
            convertResult && convertResult.status === 'success' && convertResult.result &&
            assetResult && assetResult.status === 'success' && assetResult.result
          ) {
            vaultsWithData.push({
              vault,
              underlying: assetResult.result.toLowerCase(),
              pricePerShare: convertResult.result, // This is effectively the same as pricePerShare for 1e18
            });
          }
        });
      }

      // Calculate prices for all vaults
      let successCount = 0;
      vaultsWithData.forEach(({ vault, underlying, pricePerShare }) => {
        const underlyingPrice = underlyingPrices.get(underlying);

        if (underlyingPrice && underlyingPrice.price > BigInt(0)) {
          // Calculate vault price
          // pricePerShare is usually in 18 decimals (1e18 = 1:1)
          // Result should be in 6 decimals
          const vaultPrice = (pricePerShare * underlyingPrice.price) / BigInt(10 ** 18);

          if (vaultPrice > BigInt(0)) {
            priceMap.set(vault.address.toLowerCase(), {
              address: vault.address.toLowerCase(),
              price: vaultPrice,
              source: 'yearn-vault',
            });
            successCount++;
            
            // Log specific vaults
            if (vault.address.toLowerCase() === '0x028ec7330ff87667b6dfb0d94b954c820195336c' ||
                vault.address.toLowerCase() === '0x182863131f9a4630ff9e27830d945b1413e347e8') {
              logger.info(`Priced vault ${vault.address}: underlyingPrice=${underlyingPrice.price}, vaultPrice=${vaultPrice} ($${Number(vaultPrice) / 1e6})`);
            }
          }
        }
      });

      if (successCount > 0) {
        logger.info(`Yearn Vault: Calculated ${successCount} vault prices on chain ${chainId}`);
      }
    } catch (error) {
      logger.error(`Yearn Vault fetcher failed for chain ${chainId}:`, error);
    }

    return priceMap;
  }
}