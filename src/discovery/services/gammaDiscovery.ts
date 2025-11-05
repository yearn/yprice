import axios from 'axios'
import { Discovery, TokenInfo } from 'discovery/types'
import { createHttpsAgent, deduplicateTokens, discoveryPriceCache, logger } from 'utils/index'
import { zeroAddress } from 'viem'

interface GammaHypervisor {
  id: string
  pool: string
  token0: string
  token1: string
  tick: number
  totalSupply: string
  tvl0: string
  tvl1: string
  tvlUSD: string
}

interface GammaResponse {
  [key: string]: GammaHypervisor
}

// Gamma API endpoints - same endpoint for all chains
const GAMMA_API_URL = 'https://wire2.gamma.xyz/hypervisors/allData'

export class GammaDiscovery implements Discovery {
  private chainId: number

  constructor(chainId: number) {
    this.chainId = chainId
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []
    const apiUrl = GAMMA_API_URL

    try {
      const httpsAgent = createHttpsAgent()

      const response = await axios.get<GammaResponse>(apiUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'yearn-pricing-service' },
        httpsAgent: httpsAgent,
      })

      if (response.data) {
        for (const [address, hypervisor] of Object.entries(response.data)) {
          // Add hypervisor LP token
          tokens.push({
            address: address.toLowerCase(),
            chainId: this.chainId,
            source: 'gamma-lp',
          })

          // Cache price data for the LP token
          const tvlUSD = parseFloat(hypervisor.tvlUSD || '0')
          const totalSupply = parseFloat(hypervisor.totalSupply || '0')

          if (tvlUSD > 0 && totalSupply > 0) {
            const pricePerToken = tvlUSD / totalSupply
            const price = BigInt(Math.floor(pricePerToken * 1e6))

            if (price > BigInt(0)) {
              discoveryPriceCache.set(this.chainId, address, price, 'gamma', {
                tvlUSD: hypervisor.tvlUSD,
                totalSupply: hypervisor.totalSupply,
              })
            }
          }

          // Add token0
          if (hypervisor.token0 && hypervisor.token0 !== zeroAddress) {
            tokens.push({
              address: hypervisor.token0.toLowerCase(),
              chainId: this.chainId,
              source: 'gamma-token',
            })
          }

          // Add token1
          if (hypervisor.token1 && hypervisor.token1 !== zeroAddress) {
            tokens.push({
              address: hypervisor.token1.toLowerCase(),
              chainId: this.chainId,
              source: 'gamma-token',
            })
          }

          // Also add the pool address if it exists
          if (hypervisor.pool && hypervisor.pool !== zeroAddress) {
            tokens.push({
              address: hypervisor.pool.toLowerCase(),
              chainId: this.chainId,
              source: 'gamma-pool',
            })
          }
        }
      }

      logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} Gamma tokens`)
    } catch (error: any) {
      logger.warn(`Gamma discovery failed for chain ${this.chainId}:`, error.message)
    }

    return deduplicateTokens(tokens)
  }
}
