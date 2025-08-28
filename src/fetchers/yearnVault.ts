import { parseAbi, type Address } from 'viem';
import { ERC20Token, Price } from '../models';
import { logger, batchReadContracts } from '../utils';

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

      // Filter for Yearn vaults
      const yearnVaults = tokens.filter(token => {
        const symbol = token.symbol?.toLowerCase() || '';
        const name = token.name?.toLowerCase() || '';
        return (
          symbol.startsWith('yv') ||
          symbol.startsWith('vy') ||
          name.includes('yearn') ||
          name.includes('vault') && name.includes('yfi')
        );
      });

      if (yearnVaults.length === 0) {
        return priceMap;
      }

      logger.info(`Yearn Vault: Checking ${yearnVaults.length} potential vaults on chain ${chainId}`);

      // Try V2 method: pricePerShare()
      const v2PriceContracts = yearnVaults.map(vault => ({
        address: vault.address as Address,
        abi: YEARN_VAULT_V2_ABI,
        functionName: 'pricePerShare' as const,
        args: [],
      }));

      const v2PriceResults = await batchReadContracts<bigint>(chainId, v2PriceContracts);

      // Also get underlying token addresses
      const tokenContracts = yearnVaults.map(vault => ({
        address: vault.address as Address,
        abi: YEARN_VAULT_V2_ABI,
        functionName: 'token' as const,
        args: [],
      }));

      const tokenResults = await batchReadContracts<Address>(chainId, tokenContracts);

      // Process V2 vaults
      const v2Vaults: { vault: ERC20Token; underlying: string; pricePerShare: bigint }[] = [];
      
      yearnVaults.forEach((vault, index) => {
        const priceResult = v2PriceResults[index];
        const tokenResult = tokenResults[index];
        
        if (
          priceResult && priceResult.status === 'success' && priceResult.result &&
          tokenResult && tokenResult.status === 'success' && tokenResult.result
        ) {
          v2Vaults.push({
            vault,
            underlying: tokenResult.result.toLowerCase(),
            pricePerShare: priceResult.result,
          });
        }
      });

      // Try V3 method for vaults that didn't work with V2
      const v3Vaults = yearnVaults.filter(
        vault => !v2Vaults.find(v => v.vault.address === vault.address)
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
            v2Vaults.push({
              vault,
              underlying: assetResult.result.toLowerCase(),
              pricePerShare: convertResult.result, // This is effectively the same as pricePerShare for 1e18
            });
          }
        });
      }

      // Calculate prices for all vaults
      let successCount = 0;
      v2Vaults.forEach(({ vault, underlying, pricePerShare }) => {
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