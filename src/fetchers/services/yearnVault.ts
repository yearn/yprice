import { ERC20Token, Price } from 'models/index'
import { batchReadContracts, discoveryPriceCache, logger } from 'utils/index'
import { type Address, parseAbi } from 'viem'

// Yearn Vault V2 ABI
const YEARN_VAULT_V2_ABI = parseAbi([
  'function pricePerShare() view returns (uint256)',
  'function token() view returns (address)',
  'function decimals() view returns (uint8)',
  'function totalAssets() view returns (uint256)',
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
      const v2VaultsNeedingFetch: ERC20Token[] = []
      const v3VaultsNeedingFetch: ERC20Token[] = []
      const unknownVaultsNeedingFetch: ERC20Token[] = []

      yearnVaults.forEach((vault) => {
        const cached = discoveryPriceCache.get(chainId, vault.address)
        if (cached?.data?.pricePerShare && cached?.data?.underlyingAddress) {
          vaultsWithData.push({
            vault,
            underlying: cached.data.underlyingAddress,
            pricePerShare: cached.data.pricePerShare,
          })
        } else {
          // Use cached vault version to determine which method to use
          const vaultVersion = cached?.data?.vaultVersion
          if (vaultVersion === 'v2') {
            v2VaultsNeedingFetch.push(vault)
          } else if (vaultVersion === 'v3') {
            v3VaultsNeedingFetch.push(vault)
          } else {
            unknownVaultsNeedingFetch.push(vault)
          }
        }
      })

      if (vaultsWithData.length > 0) {
        logger.debug(`Yearn Vault: Using ${vaultsWithData.length} cached pricePerShare values`)
      }

      // Batch all on-chain calls together for maximum efficiency
      const allContracts: any[] = []
      const contractInfo: {
        vault: ERC20Token
        type: 'v2' | 'v3' | 'unknown'
        dataIndex: number
      }[] = []

      // Add V2 vaults (known version)
      v2VaultsNeedingFetch.forEach((vault) => {
        contractInfo.push({ vault, type: 'v2', dataIndex: allContracts.length })
        allContracts.push(
          {
            address: vault.address as Address,
            abi: YEARN_VAULT_V2_ABI,
            functionName: 'pricePerShare' as const,
            args: [],
          },
          {
            address: vault.address as Address,
            abi: YEARN_VAULT_V2_ABI,
            functionName: 'token' as const,
            args: [],
          },
        )
      })

      // Add V3 vaults (known version)
      v3VaultsNeedingFetch.forEach((vault) => {
        contractInfo.push({ vault, type: 'v3', dataIndex: allContracts.length })
        allContracts.push(
          {
            address: vault.address as Address,
            abi: YEARN_VAULT_V3_ABI,
            functionName: 'convertToAssets' as const,
            args: [BigInt(10 ** 18)],
          },
          {
            address: vault.address as Address,
            abi: YEARN_VAULT_V3_ABI,
            functionName: 'asset' as const,
            args: [],
          },
        )
      })

      // For unknown vaults, try both V2 and V3 methods
      unknownVaultsNeedingFetch.forEach((vault) => {
        contractInfo.push({ vault, type: 'unknown', dataIndex: allContracts.length })
        allContracts.push(
          // V2 methods
          {
            address: vault.address as Address,
            abi: YEARN_VAULT_V2_ABI,
            functionName: 'pricePerShare' as const,
            args: [],
          },
          {
            address: vault.address as Address,
            abi: YEARN_VAULT_V2_ABI,
            functionName: 'token' as const,
            args: [],
          },
          // V3 methods
          {
            address: vault.address as Address,
            abi: YEARN_VAULT_V3_ABI,
            functionName: 'convertToAssets' as const,
            args: [BigInt(10 ** 18)],
          },
          {
            address: vault.address as Address,
            abi: YEARN_VAULT_V3_ABI,
            functionName: 'asset' as const,
            args: [],
          },
        )
      })

      // Execute all calls in a single batch
      if (allContracts.length > 0) {
        logger.debug(
          `Yearn Vault: Fetching on-chain data for ${v2VaultsNeedingFetch.length} V2, ${v3VaultsNeedingFetch.length} V3, and ${unknownVaultsNeedingFetch.length} unknown vaults`,
        )

        const results = await batchReadContracts<any>(chainId, allContracts)

        // Process results based on vault type
        contractInfo.forEach(({ vault, type, dataIndex }) => {
          if (type === 'v2') {
            const priceResult = results[dataIndex]
            const tokenResult = results[dataIndex + 1]
            if (
              priceResult?.status === 'success' &&
              priceResult.result &&
              tokenResult?.status === 'success' &&
              tokenResult.result
            ) {
              vaultsWithData.push({
                vault,
                underlying: (tokenResult.result as Address).toLowerCase(),
                pricePerShare: priceResult.result as bigint,
              })
            }
          } else if (type === 'v3') {
            const convertResult = results[dataIndex]
            const assetResult = results[dataIndex + 1]
            if (
              convertResult?.status === 'success' &&
              convertResult.result &&
              assetResult?.status === 'success' &&
              assetResult.result
            ) {
              vaultsWithData.push({
                vault,
                underlying: (assetResult.result as Address).toLowerCase(),
                pricePerShare: convertResult.result as bigint,
              })
            }
          } else {
            // Unknown type - try V2 first, then V3
            const v2PriceResult = results[dataIndex]
            const v2TokenResult = results[dataIndex + 1]
            const v3ConvertResult = results[dataIndex + 2]
            const v3AssetResult = results[dataIndex + 3]

            if (
              v2PriceResult?.status === 'success' &&
              v2PriceResult.result &&
              v2TokenResult?.status === 'success' &&
              v2TokenResult.result
            ) {
              vaultsWithData.push({
                vault,
                underlying: (v2TokenResult.result as Address).toLowerCase(),
                pricePerShare: v2PriceResult.result as bigint,
              })
              // Cache the discovered version
              const cached = discoveryPriceCache.get(chainId, vault.address)
              discoveryPriceCache.set(chainId, vault.address, undefined, 'yearn-vault', {
                ...cached?.data,
                vaultVersion: 'v2',
              })
            } else if (
              v3ConvertResult?.status === 'success' &&
              v3ConvertResult.result &&
              v3AssetResult?.status === 'success' &&
              v3AssetResult.result
            ) {
              vaultsWithData.push({
                vault,
                underlying: (v3AssetResult.result as Address).toLowerCase(),
                pricePerShare: v3ConvertResult.result as bigint,
              })
              // Cache the discovered version
              const cached = discoveryPriceCache.get(chainId, vault.address)
              discoveryPriceCache.set(chainId, vault.address, undefined, 'yearn-vault', {
                ...cached?.data,
                vaultVersion: 'v3',
              })
            }
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
