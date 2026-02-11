import { Discovery, TokenInfo } from 'discovery/types'
import {
  batchReadContracts,
  deduplicateTokens,
  fetchJson,
  getPublicClient,
  logger,
} from 'utils/index'
import { priceCache } from 'utils/priceCache'
import { type Address, parseAbi, zeroAddress } from 'viem'

interface KongVault {
  address: string
  pricePerShare: string
  token: string // This is the token address as a string
  asset?: {
    address: string
    name?: string
    symbol?: string
    decimals?: number
  }
}

interface KongGraphQLResponse {
  data: {
    vaults: KongVault[]
  }
}

const REGISTRY_ADDRESSES: Record<number, string> = {}

const V3_REGISTRY_ADDRESSES: Record<number, string[]> = {}

const REGISTRY_ABI = parseAbi([
  'function numVaults() view returns (uint256)',
  'function vaults(uint256 index) view returns (address)',
])

const VAULT_ABI = parseAbi([
  'function token() view returns (address)',
  'function asset() view returns (address)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

export class YearnDiscovery implements Discovery {
  private chainId: number
  private kongUrl: string = 'https://kong.yearn.farm/api/gql'
  private registryAddress?: string
  private v3RegistryAddresses: string[] = []

  constructor(chainId: number, _rpcUrl?: string) {
    this.chainId = chainId
    this.registryAddress = REGISTRY_ADDRESSES[chainId]
    this.v3RegistryAddresses = V3_REGISTRY_ADDRESSES[chainId] || []
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    try {
      // Run all discovery methods in parallel for maximum performance
      const [kongResult, v2Result, v3Result] = await Promise.allSettled([
        this.discoverFromKong(),
        this.discoverFromRegistry(),
        this.discoverFromV3Registries(),
      ])

      // Process Kong results
      if (kongResult.status === 'fulfilled') {
        tokens.push(...kongResult.value)
      } else {
        logger.debug(
          `Kong discovery failed for chain ${this.chainId}: ${kongResult.reason?.message || 'Unknown error'}`,
        )
      }

      // Process V2 registry results
      if (v2Result.status === 'fulfilled') {
        tokens.push(...v2Result.value)
      } else if (this.registryAddress) {
        logger.debug(
          `V2 registry discovery failed for chain ${this.chainId}: ${v2Result.reason?.message || 'Unknown error'}`,
        )
      }

      // Process V3 registry results
      if (v3Result.status === 'fulfilled') {
        tokens.push(...v3Result.value)
      } else if (this.v3RegistryAddresses.length > 0) {
        logger.debug(
          `V3 registry discovery failed for chain ${this.chainId}: ${v3Result.reason?.message || 'Unknown error'}`,
        )
      }

      // Log discovery summary
      const vaultCount = tokens.filter((t) => t.isVault).length
      const underlyingCount = tokens.filter((t) => t.source?.includes('underlying')).length
      logger.info(
        `YearnDiscovery complete for chain ${this.chainId}: ${vaultCount} vaults, ${underlyingCount} underlying tokens, ${tokens.length} total`,
      )
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error)
      logger.warn(
        `Yearn discovery failed for chain ${this.chainId}: ${(errorMsg || 'Unknown error').substring(0, 100)}`,
      )
    }

    return deduplicateTokens(tokens)
  }

  private async discoverFromKong(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

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
      `

      const data = await fetchJson<KongGraphQLResponse>(this.kongUrl, {
        method: 'POST',
        data: { query },
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' },
      })

      const vaults = data?.data?.vaults

      if (Array.isArray(vaults)) {
        logger.debug(`Kong API returned ${vaults.length} vaults for chain ${this.chainId}`)

        for (const vault of vaults) {
          // Add vault token
          if (vault.address) {
            tokens.push({
              address: vault.address.toLowerCase(),
              chainId: this.chainId,
              source: 'yearn-vault',
              isVault: true,
            })

            // Cache pricePerShare data for the vault
            if (vault.pricePerShare) {
              const pricePerShare = BigInt(Math.round(Number(vault.pricePerShare)))
              const underlyingAddress = vault.asset?.address || vault.token
              const underlyingDecimals = vault.asset?.decimals
              // Determine vault version based on whether asset field exists
              const vaultVersion = vault.asset?.address ? 'v3' : 'v2'

              priceCache.setDiscovered(this.chainId, vault.address, undefined, 'yearn-vault', {
                pricePerShare,
                underlyingAddress: underlyingAddress?.toLowerCase(),
                underlyingDecimals,
                vaultVersion,
              })
            }
          }

          // Add underlying token (from asset field for v3 or token field for v2)
          const tokenAddress = vault.asset?.address || vault.token
          if (tokenAddress && tokenAddress !== zeroAddress) {
            tokens.push({
              address: tokenAddress.toLowerCase(),
              chainId: this.chainId,
              source: 'yearn-underlying',
              name: vault.asset?.name,
              symbol: vault.asset?.symbol,
              decimals: vault.asset?.decimals,
            })
          }
        }

        // If Kong didn't return token info, fetch it on-chain
        const vaultsWithoutTokenInfo = vaults.filter(
          (v) => !v.asset?.address && !v.token && v.address,
        )
        if (vaultsWithoutTokenInfo.length > 0) {
          const underlyingTokens = await this.fetchUnderlyingTokens(
            vaultsWithoutTokenInfo.map((v) => v.address as Address),
          )
          tokens.push(...underlyingTokens)
        }
      }
    } catch (error: any) {
      logger.warn(
        `Kong GraphQL fetch failed for chain ${this.chainId}: ${error.message || 'Unknown error'}`,
      )
    }

    // Log discovery summary
    const vaultCount = tokens.filter((t) => t.source === 'yearn-vault').length
    const underlyingCount = tokens.filter((t) => t.source === 'yearn-underlying').length
    logger.debug(
      `YearnDiscovery Kong summary for chain ${this.chainId}: ${vaultCount} vaults, ${underlyingCount} underlying tokens, ${tokens.length} total`,
    )

    return tokens
  }

  private async fetchUnderlyingTokens(vaultAddresses: Address[]): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    try {
      // Batch all token/asset calls together for maximum efficiency
      const contracts = vaultAddresses.flatMap((vaultAddress) => [
        {
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: 'token' as const, // V2 method
          args: [],
        },
        {
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: 'asset' as const, // V3 method
          args: [],
        },
      ])

      const results = await batchReadContracts<Address>(this.chainId, contracts)

      // Process results - each vault has 2 results (token and asset)
      for (let i = 0; i < vaultAddresses.length; i++) {
        const vaultAddress = vaultAddresses[i]
        if (!vaultAddress) continue // Skip if undefined

        const tokenResult = results[i * 2] // V2 token() result
        const assetResult = results[i * 2 + 1] // V3 asset() result

        // Use whichever succeeds (V2 token or V3 asset)
        let underlyingAddress: Address | undefined
        let vaultVersion: 'v2' | 'v3' | undefined

        if (
          tokenResult &&
          tokenResult.status === 'success' &&
          tokenResult.result &&
          tokenResult.result !== zeroAddress
        ) {
          underlyingAddress = tokenResult.result
          vaultVersion = 'v2'
        } else if (
          assetResult &&
          assetResult.status === 'success' &&
          assetResult.result &&
          assetResult.result !== zeroAddress
        ) {
          underlyingAddress = assetResult.result
          vaultVersion = 'v3'
        }

        if (underlyingAddress && vaultAddress) {
          tokens.push({
            address: underlyingAddress.toLowerCase(),
            chainId: this.chainId,
            source: 'yearn-underlying',
          })

          // Cache the vault version for later use
          const cachedData = priceCache.getDiscovered(this.chainId, vaultAddress)
          priceCache.setDiscovered(this.chainId, vaultAddress, undefined, 'yearn-vault', {
            ...cachedData?.metadata,
            underlyingAddress: underlyingAddress.toLowerCase(),
            vaultVersion,
          })
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error)
      logger.warn(
        `Failed to fetch underlying tokens for chain ${this.chainId}: ${(errorMsg || 'Unknown error').substring(0, 100)}`,
      )
    }

    return tokens
  }

  private async discoverFromV3Registries(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    // Process all V3 registries in parallel for better performance
    const registryPromises = this.v3RegistryAddresses.map(async (registryAddress) => {
      try {
        const registryTokens = await this.discoverFromSpecificRegistry(registryAddress, 'v3')
        logger.debug(
          `Discovered ${registryTokens.length} tokens from V3 registry ${registryAddress} on chain ${this.chainId}`,
        )
        return registryTokens
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error)
        logger.warn(
          `V3 registry ${registryAddress} discovery failed for chain ${this.chainId}: ${(errorMsg || 'Unknown error').substring(0, 100)}`,
        )
        return [] // Return empty array on error to continue with other registries
      }
    })

    // Wait for all registries to complete and collect results
    const allResults = await Promise.all(registryPromises)
    allResults.forEach((registryTokens) => {
      tokens.push(...registryTokens)
    })

    return tokens
  }

  private async discoverFromRegistry(): Promise<TokenInfo[]> {
    if (!this.registryAddress) {
      return []
    }

    return this.discoverFromSpecificRegistry(this.registryAddress, 'v2')
  }

  private async discoverFromSpecificRegistry(
    registryAddress: string,
    version: 'v2' | 'v3',
  ): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []
    const publicClient = getPublicClient(this.chainId)

    try {
      const numVaults = (await publicClient.readContract({
        address: registryAddress as Address,
        abi: REGISTRY_ABI,
        functionName: 'numVaults',
      })) as bigint
      const vaultCount = Number(numVaults)

      logger.debug(
        `Fetching ${vaultCount} Yearn ${version} vaults from registry on chain ${this.chainId}`,
      )

      const vaultIndexContracts = []
      const maxVaultsToFetch = this.chainId === 1 ? 500 : 200 // Higher limit on mainnet
      for (let i = 0; i < Math.min(vaultCount, maxVaultsToFetch); i++) {
        vaultIndexContracts.push({
          address: registryAddress as Address,
          abi: REGISTRY_ABI,
          functionName: 'vaults' as const,
          args: [BigInt(i)],
        })
      }

      const vaultAddressResults = await batchReadContracts<Address>(
        this.chainId,
        vaultIndexContracts,
      )
      const vaultAddresses: Address[] = []

      vaultAddressResults.forEach((result) => {
        if (result && result.status === 'success' && result.result) {
          vaultAddresses.push(result.result)
        }
      })

      for (const vaultAddress of vaultAddresses) {
        tokens.push({
          address: vaultAddress.toLowerCase(),
          chainId: this.chainId,
          source: `yearn-${version}-vault`,
          isVault: true,
        })

        // Cache vault version for later use
        const cachedData = priceCache.getDiscovered(this.chainId, vaultAddress)
        priceCache.setDiscovered(this.chainId, vaultAddress, undefined, 'yearn-vault', {
          ...cachedData?.metadata,
          vaultVersion: version,
        })
      }

      const underlyingTokens = await this.fetchUnderlyingTokens(vaultAddresses)
      tokens.push(...underlyingTokens)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error)
      logger.warn(
        `Yearn ${version} registry discovery failed for chain ${this.chainId}: ${(errorMsg || 'Unknown error').substring(0, 100)}`,
      )
    }

    return tokens
  }
}
