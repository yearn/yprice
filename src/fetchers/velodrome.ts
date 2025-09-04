import { DISCOVERY_CONFIGS } from 'discovery/config'
import { ERC20Token, Price } from 'models/index'
import { batchReadContracts, getPublicClient, logger } from 'utils/index'
import { type Address, parseAbi, zeroAddress } from 'viem'

// Sugar Oracle contract addresses
const SUGAR_ORACLE_ADDRESSES: Record<number, string> = {
  10: '0x395942C2049604a314d39F370Dfb8D87AAC89e16', // Optimism (Velodrome) - Updated Prices oracle
  8453: '0xB98fB4C9C99dE155cCbF5A14af0dBBAd96033D6f', // Base (Aerodrome)
}

// Rate connectors for Optimism (used by Sugar Oracle)
const OPT_RATE_CONNECTORS = [
  '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db', // VELO
  '0x4200000000000000000000000000000000000042', // OP
  '0x4200000000000000000000000000000000000006', // WETH
  '0x9bcef72be871e61ed4fbbc7630889bee758eb81d', // rETH
  '0x2e3d870790dc77a83dd1d18184acc7439a53f475', // FRAX
  '0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9', // sUSD
  '0x1f32b1c2345538c0c6f582fcb022739c4a194ebb', // wstETH
  '0xbfd291da8a403daaf7e5e9dc1ec0aceacd4848b9', // USX
  '0xc3864f98f2a61a7caeb95b039d031b4e2f55e0e9', // SONNE
  '0x9485aca5bbbe1667ad97c7fe7c4531a624c8b1ed', // ERN
  '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
  '0x73cb180bf0521828d8849bc8cf2b920918e23032', // USD+
  '0x6806411765af15bddd26f8f544a34cc40cb9838b', // KUJI
  '0x6c2f7b6110a37b3b0fbdd811876be368df02e8b0', // DEUS
  '0xc5b001dc33727f8f26880b184090d3e252470d45', // ERN
  '0x6c84a8f1c29108f47a79964b5fe888d4f4d0de40', // tBTC
  '0xc40f949f8a4e094d1b49a23ea9241d289b7b2819', // LUSD
  '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', // USDT
  '0x0b2c639c533813f4aa9d7837caf62653d097ff85', // USDC.e
  '0x7f5c764cbc14f9669b88837ca1490cca17c31607', // USDC
]

// Rate connectors for Base (used by Sugar Oracle)
const BASE_RATE_CONNECTORS = [
  '0x9e53e88dcff56d3062510a745952dec4cefdff9e', // AERO
  '0x4200000000000000000000000000000000000006', // WETH
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22', // cbETH
  '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452', // wstETH
]

// Sugar ABI - complex tuple needs to be defined as a proper ABI object for viem
const SUGAR_ABI = [
  {
    inputs: [
      { name: 'limit', type: 'uint256' },
      { name: 'offset', type: 'uint256' },
    ],
    name: 'all',
    outputs: [
      {
        components: [
          { name: 'lp', type: 'address' },
          { name: 'symbol', type: 'string' },
          { name: 'decimals', type: 'uint8' },
          { name: 'liquidity', type: 'uint256' },
          { name: 'type', type: 'int24' },
          { name: 'tick', type: 'int24' },
          { name: 'sqrt_ratio', type: 'uint160' },
          { name: 'token0', type: 'address' },
          { name: 'reserve0', type: 'uint256' },
          { name: 'staked0', type: 'uint256' },
          { name: 'token1', type: 'address' },
          { name: 'reserve1', type: 'uint256' },
          { name: 'staked1', type: 'uint256' },
          { name: 'gauge', type: 'address' },
          { name: 'gauge_liquidity', type: 'uint256' },
          { name: 'gauge_alive', type: 'bool' },
          { name: 'fee', type: 'address' },
          { name: 'bribe', type: 'address' },
          { name: 'factory', type: 'address' },
          { name: 'emissions', type: 'uint256' },
          { name: 'emissions_token', type: 'address' },
          { name: 'pool_fee', type: 'uint256' },
          { name: 'unstaked_fee', type: 'uint256' },
          { name: 'token0_fees', type: 'uint256' },
          { name: 'token1_fees', type: 'uint256' },
          { name: 'nfpm', type: 'address' },
          { name: 'alm', type: 'address' },
          { name: 'root', type: 'address' },
        ],
        name: '',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const SUGAR_ORACLE_ABI = parseAbi([
  'function getManyRatesWithConnectors(uint8 length, address[] connectors) view returns (uint256[])',
])

const ERC20_ABI = parseAbi(['function decimals() view returns (uint8)'])

interface SugarPoolData {
  lp: string
  symbol: string
  decimals: number
  liquidity: bigint
  type: number
  tick: number
  sqrt_ratio: bigint
  token0: string
  reserve0: bigint
  staked0: bigint
  token1: string
  reserve1: bigint
  staked1: bigint
  gauge: string
  gauge_liquidity: bigint
  gauge_alive: boolean
  fee: string
  bribe: string
  factory: string
  emissions: bigint
  emissions_token: string
  pool_fee: bigint
  unstaked_fee: bigint
  token0_fees: bigint
  token1_fees: bigint
  nfpm: string
  alm: string
  root: string
}

export class VelodromeFetcher {
  private fetchingInProgress = new Map<number, Promise<Map<string, Price>>>()

  async fetchPrices(
    chainId: number,
    _tokens: ERC20Token[],
    existingPrices: Map<string, Price>,
  ): Promise<Map<string, Price>> {
    logger.info(`[Velodrome] fetchPrices called for chain ${chainId}`)

    // Prevent multiple concurrent fetches for the same chain
    const existingFetch = this.fetchingInProgress.get(chainId)
    if (existingFetch) {
      logger.info(
        `[Velodrome] Fetch already in progress for chain ${chainId}, returning existing promise`,
      )
      return existingFetch
    }

    const fetchPromise = this._doFetchPrices(chainId, _tokens, existingPrices)
    this.fetchingInProgress.set(chainId, fetchPromise)

    try {
      const result = await fetchPromise
      return result
    } finally {
      this.fetchingInProgress.delete(chainId)
    }
  }

  private async _doFetchPrices(
    chainId: number,
    _tokens: ERC20Token[],
    existingPrices: Map<string, Price>,
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>()

    // Only support Optimism and Base
    if (chainId !== 10 && chainId !== 8453) {
      return priceMap
    }

    const publicClient = getPublicClient(chainId)
    const config = DISCOVERY_CONFIGS[chainId]

    // Use the LP Sugar address from config for discovery
    const lpSugarAddress = config?.veloSugarAddress

    if (!lpSugarAddress) {
      logger.warn(`[Velodrome] No LP Sugar address configured for chain ${chainId}`)
      return priceMap
    }

    try {
      // Get all pools from LP Sugar contract with chain-specific config
      const chainConfig = {
        10: { batchSize: 24, maxBatches: 40, timeout: 15000 }, // Optimism - max 24 due to contract limits
        8453: { batchSize: 10, maxBatches: 20, timeout: 30000 }, // Base
      }

      const { batchSize, maxBatches, timeout } = chainConfig[chainId] || {
        batchSize: 25,
        maxBatches: 30,
        timeout: 20000,
      }
      const allPools: SugarPoolData[] = []

      logger.debug(
        `[Velodrome] Starting to fetch pools for chain ${chainId} from LP Sugar (batch size: ${batchSize}, max: ${maxBatches})`,
      )

      for (let i = 0; i < maxBatches; i++) {
        try {
          const offset = i * batchSize

          // Add timeout to prevent hanging
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`LP Sugar call timeout after ${timeout}ms`)),
              timeout,
            ),
          )

          const poolsPromise = publicClient.readContract({
            address: lpSugarAddress as Address,
            abi: SUGAR_ABI,
            functionName: 'all',
            args: [BigInt(batchSize), BigInt(offset)],
          })

          const pools = (await Promise.race([poolsPromise, timeoutPromise])) as SugarPoolData[]

          if (!pools || pools.length === 0) {
            logger.debug(`[Velodrome] Batch ${i}: No more pools found`)
            break
          }

          allPools.push(...pools)
          logger.debug(
            `[Velodrome] Batch ${i}: Fetched ${pools.length} pools (total: ${allPools.length})`,
          )

          if (pools.length < batchSize) {
            break
          }
        } catch (error: any) {
          const errorMsg = error.message || error

          if (i === 0) {
            logger.error('[Velodrome] Failed to fetch first batch from Sugar contract:', errorMsg)
            return priceMap
          }

          // For timeout errors, just warn and continue
          if (errorMsg.includes('timeout')) {
            logger.warn(`[Velodrome] Batch ${i} timed out on chain ${chainId}, continuing...`)

            // For Base, stop if we hit too many timeouts
            if (chainId === 8453 && i > 5) {
              logger.warn(`[Velodrome] Multiple timeouts on Base, stopping to prevent blocking`)
              break
            }
            continue
          }

          logger.error(`[Velodrome] Batch ${i} failed:`, errorMsg)
          break
        }
      }

      if (allPools.length === 0) {
        logger.warn('[Velodrome] No pools found')
        return priceMap
      }

      logger.debug(`[Velodrome] Found ${allPools.length} pools total`)

      // Collect unique tokens from pools
      const uniqueTokens = new Set<string>()
      const lpTokens = new Set<string>()
      for (const pool of allPools) {
        lpTokens.add(pool.lp.toLowerCase())
        if (pool.token0 && pool.token0 !== zeroAddress) {
          uniqueTokens.add(pool.token0.toLowerCase())
        }
        if (pool.token1 && pool.token1 !== zeroAddress) {
          uniqueTokens.add(pool.token1.toLowerCase())
        }
      }

      logger.info(
        `[Velodrome] Found ${lpTokens.size} LP tokens and ${uniqueTokens.size} unique component tokens`,
      )

      // Get prices from Sugar Oracle
      const tokenAddresses = Array.from(uniqueTokens)

      // Sugar Oracle expects uint8 for length, so we need to limit to 255 tokens
      // Use smaller batches for faster responses and better reliability
      const maxTokensPerCall = 50 // Smaller batches = faster responses
      const tokenBatches = []
      for (let i = 0; i < tokenAddresses.length; i += maxTokensPerCall) {
        tokenBatches.push(tokenAddresses.slice(i, i + maxTokensPerCall))
      }

      logger.debug(
        `[Velodrome] Fetching prices for ${tokenAddresses.length} tokens from Sugar Oracle (${tokenBatches.length} batches of up to ${maxTokensPerCall} tokens)`,
      )

      const allTokenPrices = new Map<string, bigint>()

      // Get the appropriate Sugar Oracle address and connectors for the chain
      const sugarOracleAddress = SUGAR_ORACLE_ADDRESSES[chainId]
      if (!sugarOracleAddress) {
        logger.warn(`[Velodrome] No Sugar Oracle configured for chain ${chainId}`)
        return priceMap
      }

      logger.info(`[Velodrome] Using Sugar Oracle at ${sugarOracleAddress} for chain ${chainId}`)

      const rateConnectors = chainId === 10 ? OPT_RATE_CONNECTORS : BASE_RATE_CONNECTORS

      // Process batches in parallel for better performance
      const batchPromises = tokenBatches.map(async (batch, batchIndex) => {
        const connectors = [...batch, ...rateConnectors].map((addr) => addr as Address)

        try {
          logger.debug(
            `[Velodrome] Starting batch ${batchIndex + 1}/${tokenBatches.length} with ${batch.length} tokens...`,
          )

          // Extended timeout for Sugar Oracle calls (30s to be safe)
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Sugar Oracle timeout after 30s (batch ${batchIndex + 1})`)),
              30000,
            ),
          )

          const oraclePromise = publicClient.readContract({
            address: sugarOracleAddress as Address,
            abi: SUGAR_ORACLE_ABI,
            functionName: 'getManyRatesWithConnectors',
            args: [batch.length, connectors],
          })

          const tokenPrices = (await Promise.race([oraclePromise, timeoutPromise])) as bigint[]

          // Map prices to addresses
          const batchResults = new Map<string, bigint>()
          for (let i = 0; i < batch.length; i++) {
            const address = batch[i]
            const price = tokenPrices[i]
            if (address && price !== undefined) {
              batchResults.set(address, price)
            }
          }

          logger.debug(`[Velodrome] Batch ${batchIndex + 1} completed: ${batchResults.size} prices`)
          return batchResults
        } catch (error: any) {
          logger.debug(`[Velodrome] Batch ${batchIndex + 1} failed: ${error.message || error}`)
          return new Map<string, bigint>()
        }
      })

      // Process up to 5 batches in parallel
      const parallelLimit = 5
      let successfulBatches = 0
      let failedBatches = 0

      for (let i = 0; i < batchPromises.length; i += parallelLimit) {
        const parallelBatch = batchPromises.slice(i, i + parallelLimit)
        const results = await Promise.all(parallelBatch)

        // Merge results and count successes/failures
        results.forEach((batchResult) => {
          if (batchResult.size > 0) {
            successfulBatches++
            batchResult.forEach((price, address) => {
              allTokenPrices.set(address, price)
            })
          } else {
            failedBatches++
          }
        })

        // Small delay between parallel groups to avoid overwhelming the RPC
        if (i + parallelLimit < batchPromises.length) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }

      // Log aggregated results
      if (failedBatches > 0) {
        logger.info(
          `[Velodrome] Chain ${chainId}: ${successfulBatches}/${batchPromises.length} batches succeeded (${failedBatches} timeouts)`,
        )

        // If all batches failed, it's likely a systemic issue
        if (successfulBatches === 0) {
          logger.error(
            `[Velodrome] All batches failed on chain ${chainId} - Sugar Oracle may be down or address is incorrect`,
          )
          return priceMap
        }
      }

      logger.debug(`[Velodrome] Sugar Oracle returned ${allTokenPrices.size} total prices`)

      // Create price map for tokens
      const tokenPriceMap = new Map<string, bigint>()
      let validPriceCount = 0
      for (const [address, price] of allTokenPrices) {
        if (price !== undefined && price > BigInt(0)) {
          tokenPriceMap.set(address, price)
          validPriceCount++
        }
      }
      logger.debug(`[Velodrome] ${validPriceCount} tokens have valid prices from Oracle`)

      // Special case for USDC (treat as $1 if no price)
      const usdcAddresses = {
        10: '0x7f5c764cbc14f9669b88837ca1490cca17c31607', // Optimism
        8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // Base
      }
      const usdcAddress = usdcAddresses[chainId]
      if (usdcAddress) {
        const usdcPrice = tokenPriceMap.get(usdcAddress)
        if (!usdcPrice || usdcPrice === BigInt(0)) {
          tokenPriceMap.set(usdcAddress, BigInt(10) ** BigInt(18)) // $1 in 18 decimals
        }
      }

      // CRITICAL OPTIMIZATION: Use multicall to fetch all decimals at once
      logger.debug(`[Velodrome] Fetching decimals for ${uniqueTokens.size} tokens using multicall`)

      const decimalsContracts = Array.from(uniqueTokens).map((address) => ({
        address: address as Address,
        abi: ERC20_ABI,
        functionName: 'decimals',
        args: [],
      }))

      // Batch the decimals calls (viem will use multicall automatically)
      const decimalsResults = await batchReadContracts<number>(chainId, decimalsContracts)

      const tokenDecimals = new Map<string, number>()
      let decimalsFetched = 0

      Array.from(uniqueTokens).forEach((address, index) => {
        const result = decimalsResults[index]
        if (result && result.status === 'success' && result.result !== undefined) {
          tokenDecimals.set(address, Number(result.result))
          decimalsFetched++
        } else {
          tokenDecimals.set(address, 18) // Default to 18
        }
      })

      logger.debug(
        `[Velodrome] Fetched decimals for ${decimalsFetched}/${uniqueTokens.size} tokens via multicall`,
      )

      // Calculate LP token prices
      let lpPricesCalculated = 0
      let lpSkippedNoPrice = 0
      let lpSkippedNoLiquidity = 0

      for (const pool of allPools) {
        const token0Price = tokenPriceMap.get(pool.token0.toLowerCase()) || BigInt(0)
        const token1Price = tokenPriceMap.get(pool.token1.toLowerCase()) || BigInt(0)

        if (token0Price === BigInt(0) || token1Price === BigInt(0)) {
          lpSkippedNoPrice++
          continue
        }

        const token0Decimals = tokenDecimals.get(pool.token0.toLowerCase()) || 18
        const token1Decimals = tokenDecimals.get(pool.token1.toLowerCase()) || 18

        // Calculate value in pool
        // Value = (token0_price * reserve0 / 10^token0_decimals) + (token1_price * reserve1 / 10^token1_decimals)
        const token0Divisor = BigInt(10) ** BigInt(token0Decimals)
        const token1Divisor = BigInt(10) ** BigInt(token1Decimals)
        const token0Value =
          token0Divisor > 0 ? (token0Price * pool.reserve0) / token0Divisor : BigInt(0)
        const token1Value =
          token1Divisor > 0 ? (token1Price * pool.reserve1) / token1Divisor : BigInt(0)
        const totalValue = token0Value + token1Value

        // Calculate LP price = total_value / liquidity * 10^6 (for 6 decimal price format)
        if (pool.liquidity > BigInt(0)) {
          // LP has 18 decimals, we want price in 6 decimals
          // price = totalValue * 10^6 * 10^18 / liquidity / 10^18 = totalValue * 10^6 / liquidity
          const lpPrice =
            (totalValue * BigInt(10 ** 6) * BigInt(10 ** 18)) / pool.liquidity / BigInt(10 ** 18)

          if (lpPrice > BigInt(0)) {
            priceMap.set(pool.lp.toLowerCase(), {
              address: pool.lp.toLowerCase(),
              price: lpPrice,
              source: 'velodrome',
            })
            lpPricesCalculated++
          }
        } else {
          lpSkippedNoLiquidity++
        }

        // Also add prices for component tokens if we don't have them yet
        if (!existingPrices.has(pool.token0.toLowerCase()) && token0Price > BigInt(0)) {
          const price0 = (token0Price * BigInt(10 ** 6)) / BigInt(10 ** 18)
          priceMap.set(pool.token0.toLowerCase(), {
            address: pool.token0.toLowerCase(),
            price: price0,
            source: 'velodrome-oracle',
          })
        }

        if (!existingPrices.has(pool.token1.toLowerCase()) && token1Price > BigInt(0)) {
          const price1 = (token1Price * BigInt(10 ** 6)) / BigInt(10 ** 18)
          priceMap.set(pool.token1.toLowerCase(), {
            address: pool.token1.toLowerCase(),
            price: price1,
            source: 'velodrome-oracle',
          })
        }
      }

      logger.debug(`[Velodrome] Summary:`)
      logger.debug(`  - LP prices calculated: ${lpPricesCalculated}`)
      logger.debug(`  - LP skipped (no component price): ${lpSkippedNoPrice}`)
      logger.debug(`  - LP skipped (no liquidity): ${lpSkippedNoLiquidity}`)
      logger.debug(`  - Total prices returned: ${priceMap.size}`)
    } catch (error) {
      logger.error(`Velodrome fetcher failed for chain ${chainId}:`, error)
    }

    return priceMap
  }
}
