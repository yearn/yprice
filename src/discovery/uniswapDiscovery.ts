import axios from 'axios'
import { Discovery, TokenInfo } from 'discovery/types'
import { batchReadContracts, deduplicateTokens, getPublicClient, logger } from 'utils/index'
import { type Address, parseAbi } from 'viem'

// Uniswap V2 Factory addresses
const UNISWAP_V2_FACTORIES: Record<number, string> = {
  1: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', // Ethereum
  10: '0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf', // Optimism
  137: '0x9E5A52F57B3038F1B8EeE45Df28e0A7564B8aB05', // Polygon
  42161: '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9', // Arbitrum
  8453: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6', // Base
}

// Uniswap V3 Factory addresses
const UNISWAP_V3_FACTORIES: Record<number, string> = {
  1: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Ethereum
  10: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Optimism
  137: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Polygon
  42161: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Arbitrum
  8453: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', // Base
}

const V2_FACTORY_ABI = parseAbi([
  'function allPairsLength() view returns (uint256)',
  'function allPairs(uint256 index) view returns (address)',
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)',
])

const V2_PAIR_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
])

// Known Uniswap token lists
const UNISWAP_TOKEN_LISTS: Record<number, string> = {
  1: 'https://tokens.uniswap.org',
  10: 'https://static.optimism.io/optimism.tokenlist.json',
  137: 'https://api-polygon-tokens.polygon.technology/tokenlists/default.tokenlist.json',
  42161: 'https://tokenlist.arbitrum.io/ArbTokenLists/arbed_arb_whitelist_era.json',
  8453: 'https://static.optimism.io/optimism.tokenlist.json',
}

export class UniswapDiscovery implements Discovery {
  private chainId: number

  constructor(chainId: number) {
    this.chainId = chainId
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    // Discover V2 pairs
    const v2Tokens = await this.discoverV2Pairs()
    tokens.push(...v2Tokens)

    // For V3, we'll use events or subgraph in production
    // For now, we can use token lists to find popular pairs
    const v3Tokens = await this.discoverV3Pools()
    tokens.push(...v3Tokens)

    logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} Uniswap tokens total`)
    return deduplicateTokens(tokens)
  }

  private async discoverV2Pairs(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []
    const factoryAddress = UNISWAP_V2_FACTORIES[this.chainId]

    if (!factoryAddress) {
      return tokens
    }

    const publicClient = getPublicClient(this.chainId)

    try {
      // Get total number of pairs
      let pairsLength: bigint
      try {
        pairsLength = (await publicClient.readContract({
          address: factoryAddress as Address,
          abi: V2_FACTORY_ABI,
          functionName: 'allPairsLength',
        })) as bigint
      } catch (error: any) {
        if (error.message?.includes('returned no data') || error.message?.includes('reverted')) {
          logger.debug(
            `Chain ${this.chainId}: Uniswap V2 factory doesn't support allPairsLength, skipping`,
          )
          return tokens
        }
        throw error
      }

      const totalPairs = Number(pairsLength)
      // Limit to recent pairs to avoid too many calls
      const maxPairs = Math.min(totalPairs, 500)
      const startIndex = Math.max(0, totalPairs - maxPairs)

      logger.debug(
        `Chain ${this.chainId}: Fetching ${maxPairs} most recent Uniswap V2 pairs from total ${totalPairs}`,
      )

      // Batch fetch pair addresses
      const pairContracts = []
      for (let i = startIndex; i < totalPairs; i++) {
        pairContracts.push({
          address: factoryAddress as Address,
          abi: V2_FACTORY_ABI,
          functionName: 'allPairs' as const,
          args: [BigInt(i)],
        })
      }

      const batchSize = 100
      for (let i = 0; i < pairContracts.length; i += batchSize) {
        const batch = pairContracts.slice(i, i + batchSize)
        const results = await batchReadContracts<Address>(this.chainId, batch)

        for (const result of results) {
          if (result && result.status === 'success' && result.result) {
            const pairAddress = result.result

            // Add LP token
            tokens.push({
              address: pairAddress.toLowerCase(),
              chainId: this.chainId,
              source: 'uniswap-v2-lp',
            })

            // Try to get underlying tokens
            try {
              const [token0Result, token1Result] = await Promise.all([
                publicClient.readContract({
                  address: pairAddress,
                  abi: V2_PAIR_ABI,
                  functionName: 'token0',
                }),
                publicClient.readContract({
                  address: pairAddress,
                  abi: V2_PAIR_ABI,
                  functionName: 'token1',
                }),
              ])

              if (token0Result) {
                tokens.push({
                  address: (token0Result as string).toLowerCase(),
                  chainId: this.chainId,
                  source: 'uniswap-v2-token',
                })
              }

              if (token1Result) {
                tokens.push({
                  address: (token1Result as string).toLowerCase(),
                  chainId: this.chainId,
                  source: 'uniswap-v2-token',
                })
              }
            } catch (_error) {
              // Skip if we can't get underlying tokens
            }
          }
        }
      }

      logger.debug(`Chain ${this.chainId}: Found ${tokens.length} Uniswap V2 tokens`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error)
      logger.warn(
        `Uniswap V2 discovery failed for chain ${this.chainId}: ${(errorMsg || 'Unknown error').substring(0, 100)}`,
      )
    }

    return tokens
  }

  private async discoverV3Pools(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    // For V3, we'll use the Graph or events in production
    // For now, just mark the factory as discovered
    const factoryAddress = UNISWAP_V3_FACTORIES[this.chainId]
    if (factoryAddress) {
      tokens.push({
        address: factoryAddress.toLowerCase(),
        chainId: this.chainId,
        source: 'uniswap-v3-factory',
      })
    }

    // Try to load from token lists for common pairs
    const tokenListUrl = UNISWAP_TOKEN_LISTS[this.chainId]
    if (tokenListUrl) {
      try {
        const response = await axios.get(tokenListUrl, { timeout: 10000 })
        if (response.data?.tokens) {
          for (const token of response.data.tokens) {
            if (token.chainId === this.chainId && token.address) {
              tokens.push({
                address: token.address.toLowerCase(),
                chainId: this.chainId,
                symbol: token.symbol,
                name: token.name,
                decimals: token.decimals,
                source: 'uniswap-tokenlist',
              })
            }
          }
        }
      } catch (_error) {
        logger.debug(`Failed to fetch Uniswap token list for chain ${this.chainId}`)
      }
    }

    return tokens
  }
}
