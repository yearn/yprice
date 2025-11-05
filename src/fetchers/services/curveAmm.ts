import { ERC20Token, Price } from 'models/index'
import { batchReadContracts, logger } from 'utils/index'
import { type Address, parseAbi } from 'viem'

// Curve LP Token ABI for get_virtual_price
const CURVE_LP_TOKEN_ABI = parseAbi([
  'function get_virtual_price() view returns (uint256)',
  'function decimals() view returns (uint8)',
])

export class CurveAmmFetcher {
  async fetchPrices(
    chainId: number,
    tokens: ERC20Token[],
    _underlyingPrices: Map<string, Price>,
  ): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>()

    try {
      // Filter for potential Curve LP tokens using source hints and names/symbols
      const potentialLpTokens = tokens.filter((token) => {
        const src = token.source?.toLowerCase() || ''
        const sym = token.symbol?.toLowerCase() || ''
        const nm = token.name?.toLowerCase() || ''
        return (
          src.includes('curve') ||
          sym.includes('crv') ||
          sym.includes('curve') ||
          nm.includes('curve')
        )
      })

      if (potentialLpTokens.length === 0) {
        return prices
      }

      logger.debug(
        `Curve AMM: Checking ${potentialLpTokens.length} potential LP tokens on chain ${chainId}`,
      )

      // Batch virtual price calls using multicall in chunks
      const chunkSize = 250
      let successCount = 0
      for (let i = 0; i < potentialLpTokens.length; i += chunkSize) {
        const batchTokens = potentialLpTokens.slice(i, i + chunkSize)
        const contracts = batchTokens.map((token) => ({
          address: token.address as Address,
          abi: CURVE_LP_TOKEN_ABI,
          functionName: 'get_virtual_price' as const,
          args: [],
        }))
        const results = await batchReadContracts<bigint>(chainId, contracts)
        batchTokens.forEach((token, idx) => {
          const result = results[idx]
          if (result && result.status === 'success' && result.result) {
            const virtualPrice = result.result
            const price = virtualPrice / BigInt(10 ** 12)
            if (price > BigInt(0)) {
              prices.set(token.address.toLowerCase(), {
                address: token.address.toLowerCase(),
                price,
                source: 'curve-amm',
              })
              successCount++
            }
          }
        })
      }

      if (successCount > 0) {
        logger.debug(`Curve AMM: Fetched ${successCount} prices for chain ${chainId}`)
      }
    } catch (error) {
      logger.error(`Curve AMM fetcher error for chain ${chainId}:`, error)
    }

    return prices
  }
}
