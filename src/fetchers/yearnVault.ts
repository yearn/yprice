import { ERC20Token, Price } from 'models/index'
import { batchReadContracts, discoveryPriceCache, logger } from 'utils/index'
import { type Address, parseAbi } from 'viem'

// Yearn Vault V2 ABI
const YEARN_VAULT_V2_ABI = parseAbi([
  'function pricePerShare() view returns (uint256)',
  'function token() view returns (address)',
  'function decimals() view returns (uint8)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
])

// Yearn Vault V3 ABI (ERC4626 compliant)
const YEARN_VAULT_V3_ABI = parseAbi([
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function asset() view returns (address)',
  'function pricePerShare() view returns (uint256)',
  'function decimals() view returns (uint8)',
])

export class YearnVaultFetcher {
  async fetchPrices(
    chainId: number,
    tokens: ERC20Token[],
    underlyingPrices: Map<string, Price>,
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>()

    try {
      // Filter for Yearn vaults - check source first, then fallback to name/symbol patterns
      const yearnVaults = tokens.filter((token) => {
        if (token.source === 'yearn-vault') {
          return true
        }

        // Fallback: check name/symbol patterns
        const symbol = token.symbol?.toLowerCase() || ''
        const name = token.name?.toLowerCase() || ''
        return (
          symbol.startsWith('yv') ||
          symbol.startsWith('vy') ||
          name.includes('yearn') ||
          (name.includes('vault') && name.includes('yfi'))
        )
      })

      if (yearnVaults.length === 0) {
        return priceMap
      }

      logger.debug(
        `Yearn Vault: Checking ${yearnVaults.length} potential vaults on chain ${chainId} (from ${tokens.length} total tokens)`,
      )

      // Create a map of token addresses to their decimals for quick lookup
      const tokenDecimalsMap = new Map<string, number>()
      tokens.forEach((token) => {
        tokenDecimalsMap.set(token.address.toLowerCase(), token.decimals)
      })

      // First check cached data from discovery
      const vaultsWithData: { vault: ERC20Token; underlying: string; pricePerShare: bigint }[] = []
      const vaultsNeedingOnChain: ERC20Token[] = []

      yearnVaults.forEach((vault) => {
        const cached = discoveryPriceCache.get(chainId, vault.address)
        if (cached?.data?.pricePerShare && cached?.data?.underlyingAddress) {
          vaultsWithData.push({
            vault,
            underlying: cached.data.underlyingAddress,
            pricePerShare: cached.data.pricePerShare,
          })
        } else {
          vaultsNeedingOnChain.push(vault)
        }
      })

      if (vaultsWithData.length > 0) {
        logger.debug(`Yearn Vault: Using ${vaultsWithData.length} cached pricePerShare values`)
      }

      // For vaults without cached data, fetch on-chain
      if (vaultsNeedingOnChain.length > 0) {
        // Try V2 method: pricePerShare()
        const v2PriceContracts = vaultsNeedingOnChain.map((vault) => ({
          address: vault.address as Address,
          abi: YEARN_VAULT_V2_ABI,
          functionName: 'pricePerShare' as const,
          args: [],
        }))

        const v2PriceResults = await batchReadContracts<bigint>(chainId, v2PriceContracts)

        // Also get underlying token addresses
        const tokenContracts = vaultsNeedingOnChain.map((vault) => ({
          address: vault.address as Address,
          abi: YEARN_VAULT_V2_ABI,
          functionName: 'token' as const,
          args: [],
        }))

        const tokenResults = await batchReadContracts<Address>(chainId, tokenContracts)

        vaultsNeedingOnChain.forEach((vault, index) => {
          const priceResult = v2PriceResults[index]
          const tokenResult = tokenResults[index]

          if (
            priceResult &&
            priceResult.status === 'success' &&
            priceResult.result &&
            tokenResult &&
            tokenResult.status === 'success' &&
            tokenResult.result
          ) {
            vaultsWithData.push({
              vault,
              underlying: tokenResult.result.toLowerCase(),
              pricePerShare: priceResult.result,
            })
          }
        })
      }

      // Try V3 method for vaults that didn't work with V2 or cache
      const v3Vaults = vaultsNeedingOnChain.filter(
        (vault) => !vaultsWithData.find((v) => v.vault.address === vault.address),
      )

      if (v3Vaults.length > 0) {
        // For V3, use convertToAssets(1e18)
        const v3ConvertContracts = v3Vaults.map((vault) => ({
          address: vault.address as Address,
          abi: YEARN_VAULT_V3_ABI,
          functionName: 'convertToAssets' as const,
          args: [BigInt(10 ** 18)], // 1e18 shares
        }))

        const v3ConvertResults = await batchReadContracts<bigint>(chainId, v3ConvertContracts)

        // Get asset addresses for V3
        const v3AssetContracts = v3Vaults.map((vault) => ({
          address: vault.address as Address,
          abi: YEARN_VAULT_V3_ABI,
          functionName: 'asset' as const,
          args: [],
        }))

        const v3AssetResults = await batchReadContracts<Address>(chainId, v3AssetContracts)

        // Process V3 vaults
        v3Vaults.forEach((vault, index) => {
          const convertResult = v3ConvertResults[index]
          const assetResult = v3AssetResults[index]

          if (
            convertResult &&
            convertResult.status === 'success' &&
            convertResult.result &&
            assetResult &&
            assetResult.status === 'success' &&
            assetResult.result
          ) {
            vaultsWithData.push({
              vault,
              underlying: assetResult.result.toLowerCase(),
              pricePerShare: convertResult.result, // This is effectively the same as pricePerShare for 1e18
            })
          }
        })
      }

      // Calculate prices for all vaults
      let successCount = 0
      let missingUnderlyingCount = 0
      let zeroVaultPriceCount = 0

      logger.debug(
        `Yearn Vault: Have data for ${vaultsWithData.length} vaults, calculating prices...`,
      )
      logger.debug(`Yearn Vault: Available underlying prices: ${underlyingPrices.size}`)

      vaultsWithData.forEach(({ vault, underlying, pricePerShare }) => {
        const underlyingPrice = underlyingPrices.get(underlying)

        if (underlyingPrice && underlyingPrice.price > BigInt(0)) {
          // Calculate vault price
          // Yearn vaults use their underlying token's decimals for pricePerShare

          // Get underlying token's decimals from the token map
          let pricePerShareDecimals = tokenDecimalsMap.get(underlying.toLowerCase())

          // If not found in token map, try cached data
          if (!pricePerShareDecimals) {
            const cached = discoveryPriceCache.get(chainId, vault.address)
            if (cached?.data?.underlyingDecimals) {
              pricePerShareDecimals = cached.data.underlyingDecimals
            } else if (cached?.data?.decimals && vault.decimals === cached.data.decimals) {
              // If vault decimals match cached decimals, use those
              pricePerShareDecimals = cached.data.decimals
            }
          }

          // Default to 18 if we still don't have decimals
          if (!pricePerShareDecimals) {
            pricePerShareDecimals = 18
            logger.debug(
              `Using default 18 decimals for vault ${vault.address} (underlying: ${underlying})`,
            )
          }

          // Calculate vault price with correct decimals
          const vaultPrice =
            (pricePerShare * underlyingPrice.price) / BigInt(10 ** pricePerShareDecimals)

          if (vaultPrice > BigInt(0)) {
            priceMap.set(vault.address.toLowerCase(), {
              address: vault.address.toLowerCase(),
              price: vaultPrice,
              source: 'yearn-vault',
            })
            successCount++
          } else {
            zeroVaultPriceCount++
            logger.debug(
              `Zero price for vault ${vault.address}: pricePerShare=${pricePerShare}, underlyingPrice=${underlyingPrice.price}, decimals=${pricePerShareDecimals}`,
            )
          }
        } else {
          missingUnderlyingCount++
          if (vault.address.toLowerCase() === '0x32651dd149a6ec22734882f790cbeb21402663f9') {
            logger.warn(
              `Target vault missing underlying price! Underlying: ${underlying}, Has price: ${!!underlyingPrice}`,
            )
          }
        }
      })

      logger.debug(`Yearn Vault: Calculated ${successCount} vault prices on chain ${chainId}`)
      if (missingUnderlyingCount > 0) {
        logger.debug(`Yearn Vault: ${missingUnderlyingCount} vaults missing underlying prices`)
      }
      if (zeroVaultPriceCount > 0) {
        logger.debug(`Yearn Vault: ${zeroVaultPriceCount} vaults calculated to zero price`)
      }
    } catch (error) {
      logger.error(`Yearn Vault fetcher failed for chain ${chainId}:`, error)
    }

    return priceMap
  }
}
