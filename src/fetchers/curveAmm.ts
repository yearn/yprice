import { parseAbi, type Address } from 'viem';
import { ERC20Token, Price } from '../models';
import { logger, batchReadContracts } from '../utils';

// Curve LP Token ABI for get_virtual_price
const CURVE_LP_TOKEN_ABI = parseAbi([
  'function get_virtual_price() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

export class CurveAmmFetcher {
  async fetchPrices(
    chainId: number, 
    tokens: ERC20Token[], 
    _underlyingPrices: Map<string, Price>
  ): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>();
    
    try {
      
      // Filter for potential Curve LP tokens (could have symbol like "crvUSD" or similar)
      const potentialLpTokens = tokens.filter(token => 
        token.symbol?.toLowerCase().includes('crv') || 
        token.symbol?.toLowerCase().includes('curve') ||
        token.name?.toLowerCase().includes('curve')
      );

      if (potentialLpTokens.length === 0) {
        return prices;
      }

      logger.debug(`Curve AMM: Checking ${potentialLpTokens.length} potential LP tokens on chain ${chainId}`);

      // Batch all virtual price calls using multicall
      const virtualPriceContracts = potentialLpTokens.map(token => ({
        address: token.address as Address,
        abi: CURVE_LP_TOKEN_ABI,
        functionName: 'get_virtual_price' as const,
        args: [],
      }));

      const virtualPriceResults = await batchReadContracts<bigint>(chainId, virtualPriceContracts);
      
      let successCount = 0;
      potentialLpTokens.forEach((token, index) => {
        const result = virtualPriceResults[index];
        if (result && result.status === 'success' && result.result) {
          const virtualPrice = result.result;
          
          // Virtual price is in 18 decimals, convert to 6 decimals for our price format
          const price = virtualPrice / BigInt(10 ** 12);
          
          if (price > BigInt(0)) {
            prices.set(token.address.toLowerCase(), {
              address: token.address.toLowerCase(),
              price: price,
              source: 'curve-amm',
            });
            successCount++;
          }
        }
      });

      if (successCount > 0) {
        logger.debug(`Curve AMM: Fetched ${successCount} prices for chain ${chainId}`);
      }
    } catch (error) {
      logger.error(`Curve AMM fetcher error for chain ${chainId}:`, error);
    }

    return prices;
  }
}