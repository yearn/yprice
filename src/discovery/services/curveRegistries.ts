import { Discovery, TokenInfo } from 'discovery/types'
import { batchReadContracts, deduplicateTokens, getPublicClient, logger } from 'utils/index'
import { type Address, parseAbi, zeroAddress } from 'viem'

// Comprehensive Curve registry addresses based on Curve API
const CURVE_REGISTRIES: Record<number, Record<string, string>> = {
  1: {
    // Ethereum Mainnet
    main: '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5', // Main registry
    crypto: '0x8F942C20D02bEfc377D41445793068908E2250D0', // Crypto registry
    factoryCrypto: '0xF18056Bbd320E96A48e3Fbf8bC061322531aac99', // Factory crypto registry
    factoryCrvUSD: '0x4F8846Ae9380B90d2E71D5e3D042dff3E7ebb40d', // Factory crvUSD registry
    factoryTricrypto: '0x0c0e5f2ff0ff18a3be9b835635039256dc4b4963', // Factory tricrypto registry
  },
  10: {
    // Optimism
    main: '0x7DA64233Fefb352f8F501B357c018158ED8aA455',
    crypto: '0x7DA64233Fefb352f8F501B357c018158ED8aA455',
  },
  137: {
    // Polygon
    main: '0x47bB542B9dE58b970bA50c9dae444DDB4c16751a',
    crypto: '0x76303677b159EeC920Aefb14a3d765137E0A8195',
    factoryCrypto: '0x4A32De8c248533C28904b24B4cFCFE18E9F2ad01',
  },
  250: {
    // Fantom
    main: '0x0f854EA9F38ceA4B1c2FC79047E9D0134419D5d6',
    crypto: '0x4fb93D7d320E8A263F22f62C2059dFC2A8bCbC4c',
  },
  42161: {
    // Arbitrum
    main: '0x445FE580eF8d70FF569aB36e80c647af338db351',
    crypto: '0xCE18836b233C83325Cc8848CA4487e94C6288264',
    factoryCrypto: '0x9c3B46C0Ceb5B9e304FCd6D88Fc50f7DD24B31Bc',
  },
  100: {
    // Gnosis
    main: '0x8A4694401bE8F8FCCbC542CA4703Bd668E95Bfb0',
    crypto: '0xEE7671F8112AE36BD0d9E4F085Fa6455417f4255',
  },
  8453: {
    // Base
    main: '0xd3B17f862956464ae4403cCF829CE69199856e1e',
  },
}

// Registry ABIs
const MAIN_REGISTRY_ABI = parseAbi([
  'function pool_count() view returns (uint256)',
  'function pool_list(uint256 index) view returns (address)',
  'function get_pool_from_lp_token(address lp_token) view returns (address)',
  'function get_lp_token(address pool) view returns (address)',
  'function get_coins(address pool) view returns (address[8])',
  'function get_underlying_coins(address pool) view returns (address[8])',
  'function get_gauges(address pool) view returns (address[10], uint128[10])',
])

const CRYPTO_REGISTRY_ABI = parseAbi([
  'function pool_count() view returns (uint256)',
  'function pool_list(uint256 index) view returns (address)',
  'function get_lp_token(address pool) view returns (address)',
  'function get_coins(address pool) view returns (address[8])',
  'function get_gauges(address pool) view returns (address[10], uint128[10])',
])

const FACTORY_REGISTRY_ABI = parseAbi([
  'function pool_count() view returns (uint256)',
  'function pool_list(uint256 index) view returns (address)',
  'function get_token(address pool) view returns (address)',
  'function get_coins(address pool) view returns (address[2])',
  'function get_gauge(address pool) view returns (address)',
  'function is_meta(address pool) view returns (bool)',
])

export class CurveRegistriesDiscovery implements Discovery {
  private chainId: number
  private registries: Record<string, string> = {}

  constructor(chainId: number, _rpcUrl?: string) {
    this.chainId = chainId
    this.registries = CURVE_REGISTRIES[chainId] || {}
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    if (Object.keys(this.registries).length === 0) {
      logger.debug(`Chain ${this.chainId}: No Curve registries configured`)
      return tokens
    }

    // Discover from each registry type
    for (const [registryType, registryAddress] of Object.entries(this.registries)) {
      try {
        logger.debug(
          `Chain ${this.chainId}: Discovering from Curve ${registryType} registry at ${registryAddress}`,
        )

        let registryTokens: TokenInfo[] = []

        if (registryType === 'main' || registryType === 'crypto') {
          registryTokens = await this.discoverFromMainOrCryptoRegistry(
            registryAddress,
            registryType,
          )
        } else if (registryType.startsWith('factory')) {
          registryTokens = await this.discoverFromFactoryRegistry(registryAddress, registryType)
        }

        tokens.push(...registryTokens)
        logger.debug(
          `Chain ${this.chainId}: Found ${registryTokens.length} tokens from ${registryType} registry`,
        )
      } catch (error: any) {
        logger.warn(
          `Chain ${this.chainId}: Failed to discover from ${registryType} registry: ${error.message}`,
        )
      }
    }

    return deduplicateTokens(tokens)
  }

  private async discoverFromMainOrCryptoRegistry(
    registryAddress: string,
    registryType: string,
  ): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []
    const client = getPublicClient(this.chainId)

    try {
      // Get pool count
      const poolCount = await client.readContract({
        address: registryAddress as Address,
        abi: registryType === 'main' ? MAIN_REGISTRY_ABI : CRYPTO_REGISTRY_ABI,
        functionName: 'pool_count',
      })

      logger.debug(`Chain ${this.chainId}: ${registryType} registry has ${poolCount} pools`)

      // Batch fetch pool addresses
      const poolListContracts = []
      const maxPools = Math.min(Number(poolCount), 1000) // Limit to avoid too large batches

      for (let i = 0; i < maxPools; i++) {
        poolListContracts.push({
          address: registryAddress as Address,
          abi: registryType === 'main' ? MAIN_REGISTRY_ABI : CRYPTO_REGISTRY_ABI,
          functionName: 'pool_list',
          args: [BigInt(i)],
        })
      }

      // Fetch pools in batches
      const pools: Address[] = []
      const batchSize = 100

      for (let i = 0; i < poolListContracts.length; i += batchSize) {
        const batch = poolListContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)

        results.forEach((result) => {
          if (result.status === 'success' && result.result && result.result !== zeroAddress) {
            pools.push(result.result)
          }
        })
      }

      logger.debug(`Chain ${this.chainId}: Found ${pools.length} valid pools`)

      // Get LP tokens for pools
      const lpTokenContracts = pools.map((pool) => ({
        address: registryAddress as Address,
        abi: registryType === 'main' ? MAIN_REGISTRY_ABI : CRYPTO_REGISTRY_ABI,
        functionName: 'get_lp_token',
        args: [pool],
      }))

      for (let i = 0; i < lpTokenContracts.length; i += batchSize) {
        const batch = lpTokenContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)

        results.forEach((result) => {
          if (result.status === 'success' && result.result && result.result !== zeroAddress) {
            tokens.push({
              address: result.result.toLowerCase(),
              chainId: this.chainId,
              source: `curve-${registryType}-lp`,
            })
          }
        })
      }

      // Get coins for pools
      const coinsContracts = pools.map((pool) => ({
        address: registryAddress as Address,
        abi: registryType === 'main' ? MAIN_REGISTRY_ABI : CRYPTO_REGISTRY_ABI,
        functionName: 'get_coins',
        args: [pool],
      }))

      for (let i = 0; i < coinsContracts.length; i += batchSize) {
        const batch = coinsContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<readonly Address[]>(this.chainId, batch)

        results.forEach((result) => {
          if (result.status === 'success' && result.result) {
            for (const coin of result.result) {
              if (coin && coin !== zeroAddress) {
                tokens.push({
                  address: coin.toLowerCase(),
                  chainId: this.chainId,
                  source: `curve-${registryType}-coin`,
                })
              }
            }
          }
        })
      }

      // Get underlying coins if main registry
      if (registryType === 'main') {
        const underlyingContracts = pools.map((pool) => ({
          address: registryAddress as Address,
          abi: MAIN_REGISTRY_ABI,
          functionName: 'get_underlying_coins',
          args: [pool],
        }))

        for (let i = 0; i < underlyingContracts.length; i += batchSize) {
          const batch = underlyingContracts.slice(i, i + batchSize)
          const results = await batchReadContracts<readonly Address[]>(this.chainId, batch)

          results.forEach((result) => {
            if (result.status === 'success' && result.result) {
              for (const coin of result.result) {
                if (coin && coin !== zeroAddress) {
                  tokens.push({
                    address: coin.toLowerCase(),
                    chainId: this.chainId,
                    source: 'curve-main-underlying',
                  })
                }
              }
            }
          })
        }
      }

      // Get gauges
      const gaugeContracts = pools.map((pool) => ({
        address: registryAddress as Address,
        abi: registryType === 'main' ? MAIN_REGISTRY_ABI : CRYPTO_REGISTRY_ABI,
        functionName: 'get_gauges',
        args: [pool],
      }))

      for (let i = 0; i < gaugeContracts.length; i += batchSize) {
        const batch = gaugeContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<{
          0: readonly Address[]
          1: readonly bigint[]
        }>(this.chainId, batch)

        results.forEach((result) => {
          if (result.status === 'success' && result.result) {
            const gauges = result.result[0] // Access the first element of the tuple
            for (const gauge of gauges) {
              if (gauge && gauge !== zeroAddress) {
                tokens.push({
                  address: gauge.toLowerCase(),
                  chainId: this.chainId,
                  source: `curve-${registryType}-gauge`,
                })
              }
            }
          }
        })
      }
    } catch (error: any) {
      logger.error(
        `Chain ${this.chainId}: Error discovering from ${registryType} registry: ${error.message}`,
      )
    }

    return tokens
  }

  private async discoverFromFactoryRegistry(
    registryAddress: string,
    registryType: string,
  ): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []
    const client = getPublicClient(this.chainId)

    try {
      // Get pool count
      const poolCount = await client.readContract({
        address: registryAddress as Address,
        abi: FACTORY_REGISTRY_ABI,
        functionName: 'pool_count',
      })

      logger.debug(`Chain ${this.chainId}: ${registryType} registry has ${poolCount} pools`)

      // Batch fetch pool addresses
      const poolListContracts = []
      const maxPools = Math.min(Number(poolCount), 1000) // Limit to avoid too large batches

      for (let i = 0; i < maxPools; i++) {
        poolListContracts.push({
          address: registryAddress as Address,
          abi: FACTORY_REGISTRY_ABI,
          functionName: 'pool_list',
          args: [BigInt(i)],
        })
      }

      // Fetch pools in batches
      const pools: Address[] = []
      const batchSize = 100

      for (let i = 0; i < poolListContracts.length; i += batchSize) {
        const batch = poolListContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)

        results.forEach((result) => {
          if (result.status === 'success' && result.result && result.result !== zeroAddress) {
            pools.push(result.result)
          }
        })
      }

      logger.debug(`Chain ${this.chainId}: Found ${pools.length} valid pools`)

      // Get LP tokens for pools
      const tokenContracts = pools.map((pool) => ({
        address: registryAddress as Address,
        abi: FACTORY_REGISTRY_ABI,
        functionName: 'get_token',
        args: [pool],
      }))

      for (let i = 0; i < tokenContracts.length; i += batchSize) {
        const batch = tokenContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)

        results.forEach((result) => {
          if (result.status === 'success' && result.result && result.result !== zeroAddress) {
            tokens.push({
              address: result.result.toLowerCase(),
              chainId: this.chainId,
              source: `curve-${registryType}-lp`,
            })
          }
        })
      }

      // Get coins for pools
      const coinsContracts = pools.map((pool) => ({
        address: registryAddress as Address,
        abi: FACTORY_REGISTRY_ABI,
        functionName: 'get_coins',
        args: [pool],
      }))

      for (let i = 0; i < coinsContracts.length; i += batchSize) {
        const batch = coinsContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<readonly Address[]>(this.chainId, batch)

        results.forEach((result) => {
          if (result.status === 'success' && result.result) {
            for (const coin of result.result) {
              if (coin && coin !== zeroAddress) {
                tokens.push({
                  address: coin.toLowerCase(),
                  chainId: this.chainId,
                  source: `curve-${registryType}-coin`,
                })
              }
            }
          }
        })
      }

      // Get gauges
      const gaugeContracts = pools.map((pool) => ({
        address: registryAddress as Address,
        abi: FACTORY_REGISTRY_ABI,
        functionName: 'get_gauge',
        args: [pool],
      }))

      for (let i = 0; i < gaugeContracts.length; i += batchSize) {
        const batch = gaugeContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)

        results.forEach((result) => {
          if (result.status === 'success' && result.result && result.result !== zeroAddress) {
            tokens.push({
              address: result.result.toLowerCase(),
              chainId: this.chainId,
              source: `curve-${registryType}-gauge`,
            })
          }
        })
      }
    } catch (error: any) {
      logger.error(
        `Chain ${this.chainId}: Error discovering from ${registryType} registry: ${error.message}`,
      )
    }

    return tokens
  }
}
