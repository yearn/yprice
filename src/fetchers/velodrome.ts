import { ERC20Token, Price } from 'models/index'
import { getPublicClient, logger } from 'utils/index'
import { type Address, parseAbi } from 'viem'

// Sugar Oracle contract addresses
const SUGAR_ORACLE_ADDRESSES: Record<number, string> = {
  10: '0xcA97e5653d775cA689BED5D0B4164b7656677011', // Optimism (Velodrome)
  8453: '0xB98fB4C9C99dE155cCbF5A14af0dBBAd96033D6f', // Base (Aerodrome)
}

// Rate connectors for Optimism (used by Sugar Oracle)
const OPT_RATE_CONNECTORS = [
  '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db',
  '0x4200000000000000000000000000000000000042',
  '0x4200000000000000000000000000000000000006',
  '0x9bcef72be871e61ed4fbbc7630889bee758eb81d',
  '0x2e3d870790dc77a83dd1d18184acc7439a53f475',
  '0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9',
  '0x1f32b1c2345538c0c6f582fcb022739c4a194ebb',
  '0xbfd291da8a403daaf7e5e9dc1ec0aceacd4848b9',
  '0xc3864f98f2a61a7caeb95b039d031b4e2f55e0e9',
  '0x9485aca5bbbe1667ad97c7fe7c4531a624c8b1ed',
  '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  '0x73cb180bf0521828d8849bc8cf2b920918e23032',
  '0x6806411765af15bddd26f8f544a34cc40cb9838b',
  '0x6c2f7b6110a37b3b0fbdd811876be368df02e8b0',
  '0xc5b001dc33727f8f26880b184090d3e252470d45',
  '0x6c84a8f1c29108f47a79964b5fe888d4f4d0de40',
  '0xc40f949f8a4e094d1b49a23ea9241d289b7b2819',
  '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
  '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
  '0x7f5c764cbc14f9669b88837ca1490cca17c31607',
]

// Rate connectors for Base (used by Sugar Oracle)
const BASE_RATE_CONNECTORS = [
  '0xbf1aea8670d2528e08334083616dd9c5f3b087ae',
  '0xe3b53af74a4bf62ae5511055290838050bf764df',
  '0xf544251d25f3d243a36b07e7e7962a678f952691',
  '0x4a3a6dd60a34bb2aba60d73b4c88315e9ceb6a3d',
  '0xc5102fe9359fd9a28f877a67e36b0f050d81a3cc',
  '0x65a2508c429a6078a7bc2f7df81ab575bd9d9275',
  '0xb79dd08ea68a908a97220c76d19a6aa9cbde4376',
  '0xde5ed76e7c05ec5e4572cfc88d1acea165109e44',
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631',
  '0x9e53e88dcff56d3062510a745952dec4cefdff9e',
  '0xba5e6fa2f33f3955f0cef50c63dcc84861eab663',
  '0x8901cb2e82cc95c01e42206f8d1f417fe53e7af0',
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
  '0x9483ab65847a447e36d21af1cab8c87e9712ff93',
  '0x74ccbe53f77b08632ce0cb91d3a545bf6b8e0979',
  '0xff8adec2221f9f4d8dfbafa6b9a297d17603493d',
  '0xf34e0cff046e154cafcae502c7541b9e5fd8c249',
  '0xa61beb4a3d02decb01039e378237032b351125b4',
  '0x22a2488fe295047ba13bd8cccdbc8361dbd8cf7c',
  '0xc142171b138db17a1b7cb999c44526094a4dae05',
  '0x12063cc18a7096d170e5fc410d8623ad97ee24b3',
  '0xc19669a405067927865b40ea045a2baabbbe57f5',
  '0x9cbd543f1b1166b2df36b68eb6bb1dce24e6abdf',
  '0x9cc2fc2f75768b0307925c7935396ec9d94bba44',
  '0x8ae125e8653821e851f12a49f7765db9a9ce7384',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  '0x96e890c6b2501a69cad5dba402bfb871a2a2874c',
  '0xeb466342c4d449bc9f53a865d5cb90586f405215',
  '0xa3d1a8deb97b111454b294e2324efad13a9d8396',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631',
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  '0x4621b7a9c75199271f773ebd9a499dbd165c3191',
  '0x4200000000000000000000000000000000000006',
  '0xb79dd08ea68a908a97220c76d19a6aa9cbde4376',
  '0xf7a0dd3317535ec4f4d29adf9d620b3d8d5d5069',
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
]

const SUGAR_ORACLE_ABI = parseAbi([
  'function getManyRatesWithConnectors(uint8 length, address[] connectors) view returns (uint256[])',
])

export class VelodromeFetcher {
  private fetchingInProgress = new Map<number, Promise<Map<string, Price>>>()

  async fetchPrices(
    chainId: number,
    tokens: ERC20Token[],
    existingPrices: Map<string, Price>,
  ): Promise<Map<string, Price>> {
    // Only support Optimism and Base
    if (chainId !== 10 && chainId !== 8453) {
      return new Map<string, Price>()
    }

    logger.debug(`[Velodrome] Processing chain ${chainId} with ${tokens.length} tokens`)

    // Prevent multiple concurrent fetches for the same chain
    const existingFetch = this.fetchingInProgress.get(chainId)
    if (existingFetch) {
      logger.debug(
        `[Velodrome] Fetch already in progress for chain ${chainId}, returning existing promise`,
      )
      return existingFetch
    }

    const fetchPromise = this._doFetchPrices(chainId, tokens, existingPrices)
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
    tokens: ERC20Token[],
    existingPrices: Map<string, Price>,
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>()

    // Filter tokens that don't already have prices
    const tokensNeedingPrices = tokens.filter(
      (token) => !existingPrices.has(token.address.toLowerCase()),
    )

    if (tokensNeedingPrices.length === 0) {
      logger.debug(`[Velodrome] All tokens already have prices for chain ${chainId}`)
      return priceMap
    }

    try {
      const publicClient = getPublicClient(chainId)

      // Get the Sugar Oracle address
      const sugarOracleAddress = SUGAR_ORACLE_ADDRESSES[chainId]
      if (!sugarOracleAddress) {
        logger.warn(`[Velodrome] No Sugar Oracle configured for chain ${chainId}`)
        return priceMap
      }

      logger.debug(`[Velodrome] Using Sugar Oracle at ${sugarOracleAddress} for chain ${chainId}`)

      // Separate LP tokens from regular tokens
      const lpTokens = tokensNeedingPrices.filter(
        (token) => token.symbol?.includes('-') || token.symbol?.includes('/'),
      )
      const regularTokens = tokensNeedingPrices.filter(
        (token) => !token.symbol?.includes('-') && !token.symbol?.includes('/'),
      )

      logger.debug(
        `[Velodrome] Processing ${regularTokens.length} regular tokens and ${lpTokens.length} LP tokens`,
      )

      // Get prices for regular tokens from Sugar Oracle
      const tokenAddresses = regularTokens.map((t) => t.address.toLowerCase())

      const usdcAddresses = {
        10: '0x7f5c764cbc14f9669b88837ca1490cca17c31607', // Optimism
        8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // Base
      }
      const usdcAddress = usdcAddresses[chainId as keyof typeof usdcAddresses]?.toLowerCase()

      // Sugar Oracle expects uint8 for length, so we need to limit to 255 tokens
      const maxTokensPerCall = 10 // Very small batches to ensure success
      const tokenBatches = []
      for (let i = 0; i < tokenAddresses.length; i += maxTokensPerCall) {
        tokenBatches.push(tokenAddresses.slice(i, i + maxTokensPerCall))
      }

      if (tokenBatches.length > 0) {
        logger.debug(
          `[Velodrome] Fetching prices for ${tokenAddresses.length} tokens from Sugar Oracle (${tokenBatches.length} batches)`,
        )
      }

      const allTokenPrices = new Map<string, bigint>()

      // Get rate connectors based on chain
      const rateConnectors = chainId === 10 ? OPT_RATE_CONNECTORS : BASE_RATE_CONNECTORS

      // Process batches with limited concurrency
      const batchPromises = tokenBatches.map(async (batch, batchIndex) => {
        const connectors = [...batch, ...rateConnectors].map((addr) => addr as Address)

        try {
          logger.debug(
            `[Velodrome] Starting batch ${batchIndex + 1}/${tokenBatches.length} with ${batch.length} tokens...`,
          )

          // Timeout for Sugar Oracle calls
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Sugar Oracle timeout (batch ${batchIndex + 1})`)),
              20000,
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
            if (address && price !== undefined && price > BigInt(0)) {
              batchResults.set(address, price)
            }
          }

          logger.debug(`[Velodrome] Batch ${batchIndex + 1} completed: ${batchResults.size} prices`)
          return batchResults
        } catch (error: any) {
          const errorMsg = error.message || error
          logger.debug(`[Velodrome] Batch ${batchIndex + 1} failed: ${errorMsg}`)
          return new Map<string, bigint>()
        }
      })

      // Process batches sequentially to avoid rate limits
      const parallelLimit = 1 // Process one at a time
      const delayBetweenBatches = 200 // Small delay between batches

      let successfulBatches = 0
      let failedBatches = 0

      for (let i = 0; i < batchPromises.length; i += parallelLimit) {
        const parallelBatch = batchPromises.slice(i, i + parallelLimit)
        const results = await Promise.all(parallelBatch)

        // Merge results
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

        // Delay between parallel groups
        if (i + parallelLimit < batchPromises.length) {
          await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches))
        }
      }

      // Log results
      if (tokenBatches.length > 0) {
        if (failedBatches > 0) {
          logger.debug(
            `[Velodrome] Chain ${chainId}: ${successfulBatches}/${batchPromises.length} batches succeeded`,
          )
        }
        logger.debug(`[Velodrome] Sugar Oracle returned ${allTokenPrices.size} prices`)
      }

      // Add USDC price if missing
      if (usdcAddress && !allTokenPrices.has(usdcAddress)) {
        allTokenPrices.set(usdcAddress, BigInt(10) ** BigInt(18)) // $1 in 18 decimals
      }

      // Convert oracle prices to our format
      for (const [address, oraclePrice] of allTokenPrices) {
        if (oraclePrice > BigInt(0)) {
          // Oracle returns price in 18 decimals, we use 6
          const price = (oraclePrice * BigInt(10 ** 6)) / BigInt(10 ** 18)
          if (price > BigInt(0)) {
            priceMap.set(address, {
              address: address,
              price: price,
              source: chainId === 10 ? 'velodrome-oracle' : 'aerodrome-oracle',
            })
          }
        }
      }

      logger.debug(`[Velodrome] Total prices returned: ${priceMap.size}`)
    } catch (error: any) {
      logger.error(`Velodrome fetcher failed for chain ${chainId}:`, error)
    }

    return priceMap
  }
}
