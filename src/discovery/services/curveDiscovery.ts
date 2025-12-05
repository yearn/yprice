import axios from 'axios'
import { CurvePoolData, Discovery, TokenInfo } from 'discovery/types'
import {
  batchReadContracts,
  createHttpsAgent,
  deduplicateTokens,
  getPublicClient,
  logger,
} from 'utils/index'
import { type Address, parseAbi, zeroAddress } from 'viem'

// Curve Factory addresses for different pool types
const CURVE_FACTORIES: Record<number, Record<string, string>> = {
  1: {
    plain: '0xB9fC157394Af804a3578134A6585C0dc9cc990d4',
    metapool: '0x0959158b6040D32d04c301A72CBFD6b39E21c9AE',
    crypto: '0xF18056Bbd320E96A48e3Fbf8bC061322531aac99',
    tricrypto: '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
    'stable-ng': '0x6A8cbed756804B16E05E741eDaBd5cB544AE21bf',
    'twocrypto-ng': '0x98EE851a00abeE0d95D08cF4CA2BdCE32aeaAF7F',
  },
  10: {
    stable: '0x2db0E83599a91b508Ac268a6197b8B14F5e72840',
    'stable-ng': '0x5eeE3091f747E60a045a2E715a4c71e600e31F6E',
    'twocrypto-ng': '0xd7E72f3615aa65b92A4DBdC211E296a35512988B',
  },
  137: {
    stable: '0x722272D36ef0Da72FF51c5A65Db7b870E2e8D4ee',
    'stable-ng': '0x1764ee18e8B3ccA4787249Ceb249356192594585',
    'twocrypto-ng': '0x4A32De8c248533C28904b24B4cFCFE18E9F2ad01',
  },
  42161: {
    stable: '0xb17b674D9c5CB2e441F8e196a2f048A81355d031',
    'stable-ng': '0x2191718Cd32D840B3574FB6643ADb7fae346a03C',
    'twocrypto-ng': '0x9c3B46C0Ceb5B9e304FCd6D88Fc50f7DD24B31Bc',
  },
  100: {
    stable: '0x0BA26e3e1EbCE10032f8E5D9CF13d505F0D36187',
    'stable-ng': '0xbC0797015fcFc47d9C1856639CaE50D0e69FbEE8',
    'twocrypto-ng': '0x3d6cB2F6DcF47CDd9C13E4e3beAe9af041d8796a',
  },
  8453: {
    stable: '0xd2002373543Ce3527023C75e7518C274A51ce712',
    'stable-ng': '0x6A8cbed756804B16E05E741eDaBd5cB544AE21bf',
    'twocrypto-ng': '0xc9Fe0C63Af9A39402e8a5514f9c43Af0322b665F',
  },
}

// Curve Registry addresses
const CURVE_REGISTRIES: Record<number, Record<string, string>> = {
  1: {
    main: '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5',
    crypto: '0x8F942C20D02bEfc377D41445793068908E2250D0',
    factoryCrypto: '0xF18056Bbd320E96A48e3Fbf8bC061322531aac99',
    factoryCrvUSD: '0x4F8846Ae9380B90d2E71D5e3D042dff3E7ebb40d',
  },
  10: {
    main: '0x7DA64233Fefb352f8F501B357c018158ED8aA455',
  },
  137: {
    main: '0x47bB542B9dE58b970bA50c9dae444DDB4c16751a',
    crypto: '0x76303677b159EeC920Aefb14a3d765137E0A8195',
  },
  250: {
    main: '0x0f854EA9F38ceA4B1c2FC79047E9D0134419D5d6',
    crypto: '0x4fb93D7d320E8A263F22f62C2059dFC2A8bCbC4c',
  },
  42161: {
    main: '0x445FE580eF8d70FF569aB36e80c647af338db351',
    crypto: '0xCE18836b233C83325Cc8848CA4487e94C6288264',
  },
  100: {
    main: '0x8A4694401bE8F8FCCbC542CA4703Bd668E95Bfb0',
    crypto: '0xEE7671F8112AE36BD0d9E4F085Fa6455417f4255',
  },
  8453: {
    main: '0xd3B17f862956464ae4403cCF829CE69199856e1e',
  },
}

// ABIs
const FACTORY_ABI = parseAbi([
  'function pool_count() view returns (uint256)',
  'function pool_list(uint256 index) view returns (address)',
  'function get_lp_token(address pool) view returns (address)',
  'function get_coins(address pool) view returns (address[2])',
  'function get_gauge(address pool) view returns (address)',
])

const MAIN_REGISTRY_ABI = parseAbi([
  'function pool_count() view returns (uint256)',
  'function pool_list(uint256 index) view returns (address)',
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
])

type DiscoveryMode = 'api' | 'factories' | 'registries'

export class CurveDiscovery implements Discovery {
  private chainId: number
  private factoryAddress?: string
  private apiUrl?: string
  private mode: DiscoveryMode

  constructor(
    chainId: number,
    factoryAddress?: string,
    apiUrl?: string,
    _rpcUrl?: string,
    mode: DiscoveryMode = 'api',
  ) {
    this.chainId = chainId
    this.factoryAddress = factoryAddress
    this.apiUrl = apiUrl
    this.mode = mode
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    try {
      switch (this.mode) {
        case 'api':
          return this.discoverFromApi()
        case 'factories':
          return this.discoverFromFactories()
        case 'registries':
          return this.discoverFromRegistries()
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error)
      logger.warn(
        `Curve ${this.mode} discovery failed for chain ${this.chainId}: ${(errorMsg || 'Unknown error').substring(0, 100)}`,
      )
    }

    return deduplicateTokens(tokens)
  }

  // ============ API-based Discovery ============
  private async discoverFromApi(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    if (this.apiUrl) {
      const apiTokens = await this.fetchFromCurveApi()
      tokens.push(...apiTokens)
    }

    // Fallback to on-chain if API fails
    if (tokens.length === 0 && this.factoryAddress) {
      const onChainTokens = await this.fetchFromSingleFactory(this.factoryAddress, 'api-fallback')
      tokens.push(...onChainTokens)
    }

    return deduplicateTokens(tokens)
  }

  private async fetchFromCurveApi(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    try {
      const httpsAgent = createHttpsAgent()
      const response = await axios.get<{ success: boolean; data: { poolData: CurvePoolData[] } }>(
        this.apiUrl!,
        {
          timeout: 30000,
          headers: { 'User-Agent': 'yearn-pricing-service' },
          httpsAgent,
        },
      )

      if (response.data?.success && response.data.data?.poolData) {
        for (const pool of response.data.data.poolData) {
          if (pool.lpTokenAddress) {
            tokens.push({
              address: pool.lpTokenAddress.toLowerCase(),
              chainId: this.chainId,
              source: 'curve-lp',
              name: pool.name,
              symbol: pool.symbol,
            })
          }

          for (const coin of pool.coins || []) {
            if (coin && typeof coin === 'object' && coin.address && coin.address !== zeroAddress) {
              tokens.push({
                address: coin.address.toLowerCase(),
                chainId: this.chainId,
                source: 'curve-coin',
                name: coin.name,
                symbol: coin.symbol,
              })
            }
          }
        }
      }
    } catch (error: any) {
      logger.warn(`Curve API fetch failed for chain ${this.chainId}: ${error.message}`)
    }

    return tokens
  }

  // ============ Factory-based Discovery ============
  private async discoverFromFactories(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []
    const factories = CURVE_FACTORIES[this.chainId] || {}

    if (Object.keys(factories).length === 0) {
      return tokens
    }

    for (const [factoryType, factoryAddress] of Object.entries(factories)) {
      try {
        logger.debug(
          `Chain ${this.chainId}: Discovering Curve ${factoryType} factory pools from ${factoryAddress}`,
        )
        const factoryTokens = await this.fetchFromSingleFactory(factoryAddress, factoryType)
        tokens.push(...factoryTokens)
        logger.debug(
          `Chain ${this.chainId}: Found ${factoryTokens.length} tokens from Curve ${factoryType} factory`,
        )
      } catch (error: any) {
        logger.warn(
          `Chain ${this.chainId}: Failed to discover from Curve ${factoryType} factory: ${error.message}`,
        )
      }
    }

    return deduplicateTokens(tokens)
  }

  private async fetchFromSingleFactory(
    factoryAddress: string,
    factoryType: string,
  ): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []
    const publicClient = getPublicClient(this.chainId)
    const batchSize = 100

    try {
      let count = 0
      try {
        const poolCount = (await publicClient.readContract({
          address: factoryAddress as Address,
          abi: FACTORY_ABI,
          functionName: 'pool_count',
        })) as bigint
        count = Math.min(Number(poolCount), 500)
      } catch (error: any) {
        if (error.message?.includes('returned no data') || error.message?.includes('reverted')) {
          return tokens
        }
        throw error
      }

      // Batch fetch pool addresses
      const poolListContracts = []
      for (let i = 0; i < count; i++) {
        poolListContracts.push({
          address: factoryAddress as Address,
          abi: FACTORY_ABI,
          functionName: 'pool_list' as const,
          args: [BigInt(i)],
        })
      }

      const poolAddresses: Address[] = []
      for (let i = 0; i < poolListContracts.length; i += batchSize) {
        const batch = poolListContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)
        for (const result of results) {
          if (result?.status === 'success' && result.result) {
            poolAddresses.push(result.result)
          }
        }
      }

      // Fetch LP tokens
      const lpTokenContracts = poolAddresses.map((poolAddress) => ({
        address: factoryAddress as Address,
        abi: FACTORY_ABI,
        functionName: 'get_lp_token' as const,
        args: [poolAddress],
      }))

      for (let i = 0; i < lpTokenContracts.length; i += batchSize) {
        const batch = lpTokenContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)
        results.forEach((result, index) => {
          const lpToken =
            result?.status === 'success' && result.result ? result.result : poolAddresses[i + index]
          if (lpToken && lpToken !== zeroAddress) {
            tokens.push({
              address: lpToken.toLowerCase(),
              chainId: this.chainId,
              source: `curve-${factoryType}-lp`,
            })
          }
        })
      }

      // Fetch gauges
      try {
        const gaugeContracts = poolAddresses.map((poolAddress) => ({
          address: factoryAddress as Address,
          abi: FACTORY_ABI,
          functionName: 'get_gauge' as const,
          args: [poolAddress],
        }))

        for (let i = 0; i < gaugeContracts.length; i += batchSize) {
          const batch = gaugeContracts.slice(i, i + batchSize)
          const results = await batchReadContracts<Address>(this.chainId, batch)
          for (const result of results) {
            if (result?.status === 'success' && result.result && result.result !== zeroAddress) {
              tokens.push({
                address: result.result.toLowerCase(),
                chainId: this.chainId,
                source: `curve-${factoryType}-gauge`,
              })
            }
          }
        }
      } catch {
        // Gauges might not be available
      }

      // Fetch coins
      const coinsContracts = poolAddresses.map((poolAddress) => ({
        address: factoryAddress as Address,
        abi: FACTORY_ABI,
        functionName: 'get_coins' as const,
        args: [poolAddress],
      }))

      for (let i = 0; i < coinsContracts.length; i += batchSize) {
        const batch = coinsContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<readonly Address[]>(this.chainId, batch)
        for (const result of results) {
          if (result?.status === 'success' && result.result) {
            for (const coin of result.result) {
              if (coin && coin !== zeroAddress) {
                tokens.push({
                  address: coin.toLowerCase(),
                  chainId: this.chainId,
                  source: `curve-${factoryType}-coin`,
                })
              }
            }
          }
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error)
      logger.warn(
        `Error discovering from Curve factory ${factoryAddress}: ${(errorMsg || 'Unknown error').substring(0, 100)}`,
      )
    }

    return tokens
  }

  // ============ Registry-based Discovery ============
  private async discoverFromRegistries(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []
    const registries = CURVE_REGISTRIES[this.chainId] || {}

    if (Object.keys(registries).length === 0) {
      logger.debug(`Chain ${this.chainId}: No Curve registries configured`)
      return tokens
    }

    for (const [registryType, registryAddress] of Object.entries(registries)) {
      try {
        logger.debug(
          `Chain ${this.chainId}: Discovering from Curve ${registryType} registry at ${registryAddress}`,
        )

        let registryTokens: TokenInfo[] = []
        if (registryType === 'main' || registryType === 'crypto') {
          registryTokens = await this.fetchFromMainOrCryptoRegistry(registryAddress, registryType)
        } else if (registryType.startsWith('factory')) {
          registryTokens = await this.fetchFromFactoryRegistry(registryAddress, registryType)
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

  private async fetchFromMainOrCryptoRegistry(
    registryAddress: string,
    registryType: string,
  ): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []
    const client = getPublicClient(this.chainId)
    const batchSize = 100
    const abi = registryType === 'main' ? MAIN_REGISTRY_ABI : CRYPTO_REGISTRY_ABI

    try {
      const poolCount = await client.readContract({
        address: registryAddress as Address,
        abi,
        functionName: 'pool_count',
      })

      const maxPools = Math.min(Number(poolCount), 1000)

      // Fetch pool addresses
      const poolListContracts = []
      for (let i = 0; i < maxPools; i++) {
        poolListContracts.push({
          address: registryAddress as Address,
          abi,
          functionName: 'pool_list',
          args: [BigInt(i)],
        })
      }

      const pools: Address[] = []
      for (let i = 0; i < poolListContracts.length; i += batchSize) {
        const batch = poolListContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)
        for (const result of results) {
          if (result.status === 'success' && result.result && result.result !== zeroAddress) {
            pools.push(result.result)
          }
        }
      }

      // Fetch LP tokens
      const lpTokenContracts = pools.map((pool) => ({
        address: registryAddress as Address,
        abi,
        functionName: 'get_lp_token',
        args: [pool],
      }))

      for (let i = 0; i < lpTokenContracts.length; i += batchSize) {
        const batch = lpTokenContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)
        for (const result of results) {
          if (result.status === 'success' && result.result && result.result !== zeroAddress) {
            tokens.push({
              address: result.result.toLowerCase(),
              chainId: this.chainId,
              source: `curve-${registryType}-lp`,
            })
          }
        }
      }

      // Fetch coins
      const coinsContracts = pools.map((pool) => ({
        address: registryAddress as Address,
        abi,
        functionName: 'get_coins',
        args: [pool],
      }))

      for (let i = 0; i < coinsContracts.length; i += batchSize) {
        const batch = coinsContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<readonly Address[]>(this.chainId, batch)
        for (const result of results) {
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
        }
      }

      // Fetch underlying coins (main registry only)
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
          for (const result of results) {
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
          }
        }
      }

      // Fetch gauges
      const gaugeContracts = pools.map((pool) => ({
        address: registryAddress as Address,
        abi,
        functionName: 'get_gauges',
        args: [pool],
      }))

      for (let i = 0; i < gaugeContracts.length; i += batchSize) {
        const batch = gaugeContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<{ 0: readonly Address[]; 1: readonly bigint[] }>(
          this.chainId,
          batch,
        )
        for (const result of results) {
          if (result.status === 'success' && result.result) {
            const gauges = result.result[0]
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
        }
      }
    } catch (error: any) {
      logger.error(
        `Chain ${this.chainId}: Error discovering from ${registryType} registry: ${error.message}`,
      )
    }

    return tokens
  }

  private async fetchFromFactoryRegistry(
    registryAddress: string,
    registryType: string,
  ): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []
    const client = getPublicClient(this.chainId)
    const batchSize = 100

    try {
      const poolCount = await client.readContract({
        address: registryAddress as Address,
        abi: FACTORY_REGISTRY_ABI,
        functionName: 'pool_count',
      })

      const maxPools = Math.min(Number(poolCount), 1000)

      // Fetch pool addresses
      const poolListContracts = []
      for (let i = 0; i < maxPools; i++) {
        poolListContracts.push({
          address: registryAddress as Address,
          abi: FACTORY_REGISTRY_ABI,
          functionName: 'pool_list',
          args: [BigInt(i)],
        })
      }

      const pools: Address[] = []
      for (let i = 0; i < poolListContracts.length; i += batchSize) {
        const batch = poolListContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)
        for (const result of results) {
          if (result.status === 'success' && result.result && result.result !== zeroAddress) {
            pools.push(result.result)
          }
        }
      }

      // Fetch LP tokens
      const tokenContracts = pools.map((pool) => ({
        address: registryAddress as Address,
        abi: FACTORY_REGISTRY_ABI,
        functionName: 'get_token',
        args: [pool],
      }))

      for (let i = 0; i < tokenContracts.length; i += batchSize) {
        const batch = tokenContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)
        for (const result of results) {
          if (result.status === 'success' && result.result && result.result !== zeroAddress) {
            tokens.push({
              address: result.result.toLowerCase(),
              chainId: this.chainId,
              source: `curve-${registryType}-lp`,
            })
          }
        }
      }

      // Fetch coins
      const coinsContracts = pools.map((pool) => ({
        address: registryAddress as Address,
        abi: FACTORY_REGISTRY_ABI,
        functionName: 'get_coins',
        args: [pool],
      }))

      for (let i = 0; i < coinsContracts.length; i += batchSize) {
        const batch = coinsContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<readonly Address[]>(this.chainId, batch)
        for (const result of results) {
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
        }
      }

      // Fetch gauges
      const gaugeContracts = pools.map((pool) => ({
        address: registryAddress as Address,
        abi: FACTORY_REGISTRY_ABI,
        functionName: 'get_gauge',
        args: [pool],
      }))

      for (let i = 0; i < gaugeContracts.length; i += batchSize) {
        const batch = gaugeContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)
        for (const result of results) {
          if (result.status === 'success' && result.result && result.result !== zeroAddress) {
            tokens.push({
              address: result.result.toLowerCase(),
              chainId: this.chainId,
              source: `curve-${registryType}-gauge`,
            })
          }
        }
      }
    } catch (error: any) {
      logger.error(
        `Chain ${this.chainId}: Error discovering from ${registryType} registry: ${error.message}`,
      )
    }

    return tokens
  }
}

// Factory functions for backward compatibility
export class CurveFactoriesDiscovery implements Discovery {
  private discovery: CurveDiscovery

  constructor(chainId: number, _rpcUrl?: string) {
    this.discovery = new CurveDiscovery(chainId, undefined, undefined, _rpcUrl, 'factories')
  }

  discoverTokens(): Promise<TokenInfo[]> {
    return this.discovery.discoverTokens()
  }
}

export class CurveRegistriesDiscovery implements Discovery {
  private discovery: CurveDiscovery

  constructor(chainId: number, _rpcUrl?: string) {
    this.discovery = new CurveDiscovery(chainId, undefined, undefined, _rpcUrl, 'registries')
  }

  discoverTokens(): Promise<TokenInfo[]> {
    return this.discovery.discoverTokens()
  }
}
