import { parseAbi, type Address } from 'viem';
import { ERC20Token, Price } from '../models';
import { logger, batchReadContracts } from '../utils';

// ERC4626 Vault ABI - standard methods
const ERC4626_ABI = parseAbi([
  'function asset() view returns (address)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

export class ERC4626Fetcher {
  async fetchPrices(
    chainId: number,
    tokens: ERC20Token[],
    underlyingPrices: Map<string, Price>
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>();

    try {
      
      // Filter for potential ERC4626 vaults (usually have specific naming patterns)
      const potentialVaults = tokens.filter(token => {
        const symbol = token.symbol?.toLowerCase() || '';
        const name = token.name?.toLowerCase() || '';
        return (
          symbol.includes('vault') ||
          name.includes('vault') ||
          symbol.startsWith('yv') ||
          symbol.startsWith('av') ||
          symbol.includes('4626')
        );
      });

      if (potentialVaults.length === 0) {
        return priceMap;
      }

      logger.debug(`ERC4626: Checking ${potentialVaults.length} potential vaults on chain ${chainId}`);

      // Step 1: Batch read asset addresses for all vaults
      const assetContracts = potentialVaults.map(vault => ({
        address: vault.address as Address,
        abi: ERC4626_ABI,
        functionName: 'asset' as const,
        args: [],
      }));

      const assetResults = await batchReadContracts<Address>(chainId, assetContracts);

      // Filter vaults that successfully returned an asset address
      const validVaults: { vault: ERC20Token; asset: string }[] = [];
      potentialVaults.forEach((vault, index) => {
        const result = assetResults[index];
        if (result && result.status === 'success' && result.result) {
          validVaults.push({
            vault,
            asset: result.result.toLowerCase(),
          });
        }
      });

      if (validVaults.length === 0) {
        return priceMap;
      }

      // Step 2: Batch read convertToAssets for 1e18 shares
      const shareValueContracts = validVaults.map(({ vault }) => ({
        address: vault.address as Address,
        abi: ERC4626_ABI,
        functionName: 'convertToAssets' as const,
        args: [BigInt(10 ** 18)], // 1e18 shares
      }));

      const shareValueResults = await batchReadContracts<bigint>(chainId, shareValueContracts);

      // Step 3: Calculate vault prices based on underlying asset prices
      let successCount = 0;
      validVaults.forEach(({ vault, asset }, index) => {
        const shareValueResult = shareValueResults[index];
        
        if (shareValueResult && shareValueResult.status === 'success' && shareValueResult.result) {
          const shareValue = shareValueResult.result;
          const assetPrice = underlyingPrices.get(asset);

          if (assetPrice && assetPrice.price > BigInt(0)) {
            // Calculate vault price: (shareValue * assetPrice) / 1e18
            // shareValue is how many asset tokens you get for 1e18 vault shares
            // Result should be in 6 decimals (our standard price format)
            const vaultPrice = (shareValue * assetPrice.price) / BigInt(10 ** 18);

            if (vaultPrice > BigInt(0)) {
              priceMap.set(vault.address.toLowerCase(), {
                address: vault.address.toLowerCase(),
                price: vaultPrice,
                source: 'erc4626',
              });
              successCount++;
            }
          }
        }
      });

      if (successCount > 0) {
        logger.debug(`ERC4626: Calculated ${successCount} vault prices on chain ${chainId}`);
      }
    } catch (error) {
      logger.error(`ERC4626 fetcher failed for chain ${chainId}:`, error);
    }

    return priceMap;
  }
}