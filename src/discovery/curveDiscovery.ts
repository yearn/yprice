import https from 'node:https'
import axios from 'axios'
import { CurvePoolData, TokenInfo } from 'discovery/types'
import { batchReadContracts, getPublicClient, logger } from 'utils/index'
import { type Address, parseAbi, zeroAddress } from 'viem'

const CURVE_FACTORY_ABI = parseAbi([
  'function pool_count() view returns (uint256)',
  'function pool_list(uint256 index) view returns (address)',
  'function get_coins(address pool) view returns (address[2])',
])

export class CurveDiscovery {
  private chainId: number
  private factoryAddress?: string
  private apiUrl?: string

  constructor(chainId: number, factoryAddress?: string, apiUrl?: string, _rpcUrl?: string) {
    this.chainId = chainId
    this.factoryAddress = factoryAddress
    this.apiUrl = apiUrl
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    try {
      // Try API first as it's faster and more complete
      if (this.apiUrl) {
        const apiTokens = await this.discoverFromAPI()
        tokens.push(...apiTokens)
      }

      // If API fails or is not available, try on-chain discovery
      if (tokens.length === 0 && this.factoryAddress) {
        const onChainTokens = await this.discoverFromContract()
        tokens.push(...onChainTokens)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error)
      logger.warn(
        `Curve discovery failed for chain ${this.chainId}: ${(errorMsg || 'Unknown error').substring(0, 100)}`,
      )
    }

    return this.deduplicateTokens(tokens)
  }

  private async discoverFromAPI(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    try {
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false, // Temporarily disable SSL verification
      })

      const response = await axios.get<{ success: boolean; data: { poolData: CurvePoolData[] } }>(
        this.apiUrl!,
        {
          timeout: 30000,
          headers: { 'User-Agent': 'yearn-pricing-service' },
          httpsAgent: httpsAgent,
        },
      )

      if (response.data?.success && response.data.data?.poolData) {
        for (const pool of response.data.data.poolData) {
          // Add LP token
          if (pool.lpTokenAddress) {
            tokens.push({
              address: pool.lpTokenAddress.toLowerCase(),
              chainId: this.chainId,
              source: 'curve-lp',
              name: pool.name,
              symbol: pool.symbol,
            })
          }

          // Add coin tokens
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
      if (error.response) {
        logger.debug(
          `Response status: ${error.response.status}, data: ${JSON.stringify(error.response.data).substring(0, 200)}`,
        )
      }
    }

    return tokens
  }

  private async discoverFromContract(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    if (!this.factoryAddress) {
      return tokens
    }

    const publicClient = getPublicClient(this.chainId)

    try {
      let poolCount: bigint
      try {
        poolCount = (await publicClient.readContract({
          address: this.factoryAddress as Address,
          abi: CURVE_FACTORY_ABI,
          functionName: 'pool_count',
        })) as bigint
      } catch (error: any) {
        if (error.message?.includes('returned no data') || error.message?.includes('reverted')) {
          logger.debug(
            `Curve factory at ${this.factoryAddress} doesn't support pool_count, skipping`,
          )
          return tokens
        }
        throw error
      }
      const maxPools = Math.min(Number(poolCount), 500) // Limit to prevent too many calls

      logger.debug(`Fetching ${maxPools} Curve pools from chain ${this.chainId}`)

      // Batch fetch pool addresses using multicall
      const poolListContracts = []
      for (let i = 0; i < maxPools; i++) {
        poolListContracts.push({
          address: this.factoryAddress as Address,
          abi: CURVE_FACTORY_ABI,
          functionName: 'pool_list' as const,
          args: [BigInt(i)],
        })
      }

      const poolAddressResults = await batchReadContracts<Address>(this.chainId, poolListContracts)
      const poolAddresses: Address[] = []

      poolAddressResults.forEach((result) => {
        if (result && result.status === 'success' && result.result) {
          poolAddresses.push(result.result)
        }
      })

      // Add all pools as LP tokens
      for (const poolAddress of poolAddresses) {
        tokens.push({
          address: poolAddress.toLowerCase(),
          chainId: this.chainId,
          source: 'curve-lp',
        })
      }

      // Batch fetch coins for each pool using multicall
      const coinContracts = poolAddresses.map((poolAddr) => ({
        address: this.factoryAddress as Address,
        abi: CURVE_FACTORY_ABI,
        functionName: 'get_coins' as const,
        args: [poolAddr],
      }))

      const coinResults = await batchReadContracts<readonly Address[]>(this.chainId, coinContracts)

      coinResults.forEach((result) => {
        if (result && result.status === 'success' && result.result) {
          const coins = result.result
          for (const coin of coins) {
            if (coin && coin !== zeroAddress) {
              tokens.push({
                address: coin.toLowerCase(),
                chainId: this.chainId,
                source: 'curve-coin',
              })
            }
          }
        }
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error)
      logger.warn(
        `Curve contract discovery failed for chain ${this.chainId}: ${(errorMsg || 'Unknown error').substring(0, 100)}`,
      )
    }

    return tokens
  }

  private deduplicateTokens(tokens: TokenInfo[]): TokenInfo[] {
    const seen = new Set<string>()
    const unique: TokenInfo[] = []

    for (const token of tokens) {
      const key = `${token.chainId}-${token.address.toLowerCase()}`
      if (!seen.has(key)) {
        seen.add(key)
        unique.push(token)
      }
    }

    return unique
  }
}
