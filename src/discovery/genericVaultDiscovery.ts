import axios from 'axios'
import { Discovery, TokenInfo } from 'discovery/types'
import { logger } from 'utils/index'

interface DefLlamaYield {
  chain: string
  project: string
  symbol: string
  tvlUsd: number
  pool: string // This is the vault address
  apyBase?: number
  apyReward?: number
  underlyingTokens?: string[]
  poolMeta?: string
}

interface DefLlamaYieldsResponse {
  status: string
  data: DefLlamaYield[]
}

// Map DefLlama chain names to chain IDs
const CHAIN_ID_MAP: Record<string, number> = {
  Ethereum: 1,
  Optimism: 10,
  Gnosis: 100,
  xDai: 100,
  Polygon: 137,
  Fantom: 250,
  Base: 8453,
  Arbitrum: 42161,
}

// Known vault protocols to look for
const VAULT_PROTOCOLS = [
  'aladdin-dao',
  'concentrator',
  'concrete',
  'spectra-v2',
  'amphor',
  'cove-protocol',
  'equilibria',
  'gains-network',
  'ignition',
  'juice-finance',
  'kamino',
  'magpie',
  'mendi-finance',
  'morpho',
  'moonwell',
  'notional-v3',
  'origami',
  'pendle',
  'penpie',
  'radiant-v2',
  'reaper-farm',
  'silo',
  'sturdy',
  'tarot',
  'tempus-finance',
  'umami-finance',
  'vector-finance',
  'venus',
  'yei-finance',
  'zerolend',
]

export class GenericVaultDiscovery implements Discovery {
  private chainId: number
  private defLlamaUrl = 'https://yields.llama.fi/pools'

  constructor(chainId: number) {
    this.chainId = chainId
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    try {
      const yields = await this.fetchDefLlamaYields()
      const chainName = this.getChainName()

      if (!chainName) {
        logger.debug(`No chain mapping for chainId ${this.chainId}`)
        return tokens
      }

      // Filter yields for our chain and vault protocols
      const vaultYields = yields.filter(
        (y) =>
          y.chain === chainName &&
          (this.isVaultProtocol(y.project) || this.isVaultSymbol(y.symbol)),
      )

      logger.debug(`Chain ${this.chainId}: Found ${vaultYields.length} vault yields from DefLlama`)

      for (const vault of vaultYields) {
        // Skip if no valid address
        if (!vault.pool || !vault.pool.startsWith('0x') || vault.pool.length !== 42) {
          continue
        }

        // Add vault token
        tokens.push({
          address: vault.pool.toLowerCase(),
          chainId: this.chainId,
          symbol: vault.symbol,
          source: `vault-${vault.project}`,
          isVault: true,
        })

        // Add underlying tokens if available
        if (vault.underlyingTokens && Array.isArray(vault.underlyingTokens)) {
          for (const underlying of vault.underlyingTokens) {
            if (underlying?.startsWith('0x') && underlying.length === 42) {
              tokens.push({
                address: underlying.toLowerCase(),
                chainId: this.chainId,
                source: `vault-${vault.project}-underlying`,
              })
            }
          }
        }
      }

      logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} generic vault tokens`)
    } catch (error) {
      logger.warn(`Generic vault discovery failed for chain ${this.chainId}:`, error)
    }

    return tokens
  }

  private async fetchDefLlamaYields(): Promise<DefLlamaYield[]> {
    try {
      const response = await axios.get<DefLlamaYieldsResponse>(this.defLlamaUrl, {
        timeout: 30000,
        headers: {
          'User-Agent': 'yearn-pricing-service',
          Accept: 'application/json',
        },
      })

      if (response.data?.data) {
        return response.data.data
      }

      return []
    } catch (error) {
      logger.debug(`Failed to fetch DefLlama yields: ${error}`)
      return []
    }
  }

  private getChainName(): string | undefined {
    return Object.entries(CHAIN_ID_MAP).find(([_, id]) => id === this.chainId)?.[0]
  }

  private isVaultProtocol(project: string): boolean {
    const projectLower = project.toLowerCase()
    return VAULT_PROTOCOLS.some((vp) => projectLower.includes(vp))
  }

  private isVaultSymbol(symbol: string): boolean {
    const symbolLower = symbol.toLowerCase()
    return (
      symbolLower.includes('vault') ||
      symbolLower.startsWith('yv') ||
      symbolLower.startsWith('av') ||
      symbolLower.startsWith('sv') ||
      symbolLower.startsWith('cv') ||
      symbolLower.includes('-v') ||
      symbolLower.endsWith('vault')
    )
  }
}
