import axios from 'axios'
import { Discovery, TokenInfo } from 'discovery/types'
import { createHttpsAgent, deduplicateTokens, logger } from 'utils/index'
import { zeroAddress } from 'viem'

// Balancer subgraph endpoints - Using dev endpoints to avoid rate limits
const BALANCER_SUBGRAPHS: Record<number, string> = {
  1: 'https://api.studio.thegraph.com/query/75376/balancer-v2/version/latest',
  137: 'https://api.studio.thegraph.com/query/75376/balancer-polygon-v2/version/latest',
  42161: 'https://api.studio.thegraph.com/query/75376/balancer-arbitrum-v2/version/latest',
  10: 'https://api.studio.thegraph.com/query/75376/balancer-optimism-v2/version/latest',
  100: 'https://api.studio.thegraph.com/query/75376/balancer-gnosis-chain-v2/version/latest',
  8453: 'https://api.studio.thegraph.com/query/24660/balancer-base-v2/version/latest',
  43114: 'https://api.studio.thegraph.com/query/75376/balancer-avalanche-v2/version/latest',
}

// Balancer API for more comprehensive data
const BALANCER_API_URL = 'https://api.balancer.fi/pools/'

interface BalancerPool {
  id: string
  address: string
  poolType: string
  symbol: string
  name: string
  tokens: Array<{
    address: string
    symbol: string
    name: string
    decimals: number
  }>
}

interface BalancerSubgraphResponse {
  data: {
    pools: BalancerPool[]
  }
}

export class BalancerDiscovery implements Discovery {
  private chainId: number

  constructor(chainId: number) {
    this.chainId = chainId
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    // Try subgraph first
    const subgraphTokens = await this.discoverFromSubgraph()
    tokens.push(...subgraphTokens)

    // Try API as fallback/supplement
    const apiTokens = await this.discoverFromAPI()
    tokens.push(...apiTokens)

    logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} Balancer tokens total`)
    return deduplicateTokens(tokens)
  }

  private async discoverFromSubgraph(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []
    const subgraphUrl = BALANCER_SUBGRAPHS[this.chainId]

    if (!subgraphUrl) {
      return tokens
    }

    try {
      const query = `
        query {
          pools(first: 1000, orderBy: totalLiquidity, orderDirection: desc) {
            id
            address
            poolType
            symbol
            name
            tokens {
              address
              symbol
              name
              decimals
            }
          }
        }
      `

      const httpsAgent = createHttpsAgent()

      const response = await axios.post<BalancerSubgraphResponse>(
        subgraphUrl,
        { query },
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
          },
          httpsAgent: httpsAgent,
        },
      )

      if (response.data?.data?.pools) {
        for (const pool of response.data.data.pools) {
          // Add pool token (BPT - Balancer Pool Token)
          tokens.push({
            address: pool.address.toLowerCase(),
            chainId: this.chainId,
            symbol: pool.symbol,
            name: pool.name,
            source: 'balancer-pool',
          })

          // Add underlying tokens
          for (const token of pool.tokens || []) {
            if (token.address && token.address !== zeroAddress) {
              tokens.push({
                address: token.address.toLowerCase(),
                chainId: this.chainId,
                symbol: token.symbol,
                name: token.name,
                decimals: token.decimals,
                source: 'balancer-token',
              })
            }
          }
        }
      }

      logger.debug(
        `Chain ${this.chainId}: Discovered ${tokens.length} tokens from Balancer subgraph`,
      )
    } catch (error: any) {
      // Handle rate limiting specifically
      if (error.response?.status === 429 || error.response?.data?.includes('Too many requests')) {
        logger.warn(
          `Balancer subgraph rate limited for chain ${this.chainId} - this is expected and will retry later`,
        )
      } else if (error.response?.data?.errors?.[0]?.message?.includes('deployment')) {
        logger.debug(
          `Balancer subgraph deployment issue for chain ${this.chainId}: ${error.response.data.errors[0].message}`,
        )
      } else {
        logger.warn(`Balancer subgraph discovery failed for chain ${this.chainId}:`, error.message)
      }

      if (error.response) {
        logger.debug(
          `Response status: ${error.response.status}, data: ${JSON.stringify(error.response.data).substring(0, 200)}`,
        )
      }
    }

    return tokens
  }

  private async discoverFromAPI(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    try {
      // Map chain IDs to Balancer network names
      const networkMap: Record<number, string> = {
        1: 'MAINNET',
        137: 'POLYGON',
        42161: 'ARBITRUM',
        10: 'OPTIMISM',
        100: 'GNOSIS',
        8453: 'BASE',
        43114: 'AVALANCHE',
      }

      const network = networkMap[this.chainId]
      if (!network) {
        return tokens
      }

      const httpsAgent = createHttpsAgent()

      const response = await axios.get(`${BALANCER_API_URL}${this.chainId}`, {
        timeout: 30000,
        headers: {
          Accept: 'application/json',
        },
        httpsAgent: httpsAgent,
      })

      if (response.data && Array.isArray(response.data)) {
        for (const pool of response.data) {
          // Add pool token
          if (pool.address) {
            tokens.push({
              address: pool.address.toLowerCase(),
              chainId: this.chainId,
              symbol: pool.symbol,
              name: pool.name,
              source: 'balancer-api-pool',
            })
          }

          // Add pool tokens
          for (const token of pool.poolTokens || []) {
            if (token.address && token.address !== zeroAddress) {
              tokens.push({
                address: token.address.toLowerCase(),
                chainId: this.chainId,
                symbol: token.symbol,
                name: token.name,
                source: 'balancer-api-token',
              })
            }
          }
        }
      }

      logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} tokens from Balancer API`)
    } catch (error: any) {
      // API might not be available for all chains
      logger.debug(`Balancer API discovery failed for chain ${this.chainId}:`, error.message)
    }

    return tokens
  }
}
