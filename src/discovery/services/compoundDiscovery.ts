import { Discovery, TokenInfo } from 'discovery/types'
import { batchReadContracts, deduplicateTokens, getPublicClient, logger } from 'utils/index'
import { type Address, parseAbi } from 'viem'

const COMPOUND_COMPTROLLER_ABI = parseAbi(['function getAllMarkets() view returns (address[])'])

const CTOKEN_ABI = parseAbi([
  'function underlying() view returns (address)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
])

export class CompoundDiscovery implements Discovery {
  private chainId: number
  private comptrollerAddress?: string

  constructor(chainId: number, comptrollerAddress?: string, _rpcUrl?: string) {
    this.chainId = chainId
    this.comptrollerAddress = comptrollerAddress
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = []

    if (!this.comptrollerAddress) {
      return tokens
    }

    const publicClient = getPublicClient(this.chainId)

    try {
      // Get all cToken markets
      const markets = (await publicClient.readContract({
        address: this.comptrollerAddress as Address,
        abi: COMPOUND_COMPTROLLER_ABI,
        functionName: 'getAllMarkets',
      })) as Address[]

      logger.debug(`Chain ${this.chainId}: Found ${markets.length} Compound markets`)

      // Add all cTokens first
      for (const cTokenAddress of markets) {
        tokens.push({
          address: cTokenAddress.toLowerCase(),
          chainId: this.chainId,
          source: 'compound-ctoken',
        })
      }

      // Batch fetch all underlying tokens
      const underlyingContracts = markets.map((cTokenAddress) => ({
        address: cTokenAddress as Address,
        abi: CTOKEN_ABI,
        functionName: 'underlying' as const,
        args: [],
      }))

      const underlyingResults = await batchReadContracts<Address>(this.chainId, underlyingContracts)

      markets.forEach((_, index) => {
        const result = underlyingResults[index]
        if (result && result.status === 'success' && result.result) {
          const underlying = result.result
          if (!underlying) return
          tokens.push({
            address: underlying.toLowerCase(),
            chainId: this.chainId,
            source: 'compound-underlying',
          })
        }
      })

      logger.debug(`Chain ${this.chainId}: Discovered ${tokens.length} Compound tokens`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error)
      logger.warn(
        `Compound discovery failed for chain ${this.chainId}: ${(errorMsg || 'Unknown error').substring(0, 100)}`,
      )
    }

    return deduplicateTokens(tokens)
  }
}
