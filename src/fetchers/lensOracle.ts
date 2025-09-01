import { parseAbi, type Address } from 'viem';
import { ERC20Token, Price } from '../models';
import { logger, getPublicClient } from '../utils';

// Lens Price Oracle contract addresses by chain
const LENS_ORACLE_ADDRESSES: Record<number, string> = {
  1: '0x69ebe485a182de951f37d3f86fd29a3eb47ae80c', // Ethereum
  10: '0xbd0c7aaf0bf082712ebe919a9dd94b2d978f79a9', // Optimism
  137: '0xbd0c7aaf0bf082712ebe919a9dd94b2d978f79a9', // Polygon
  250: '0x69ebe485a182de951f37d3f86fd29a3eb47ae80c', // Fantom
  42161: '0x69ebe485a182de951f37d3f86fd29a3eb47ae80c', // Arbitrum
};

// Lens Oracle ABI
const LENS_ORACLE_ABI = parseAbi([
  'function getPrices(address[] tokens, address[] oracles) view returns (uint256[] prices)',
  'function getPrice(address token, address oracle) view returns (uint256)',
]);

export class LensOracleFetcher {
  async fetchPrices(
    chainId: number,
    tokens: ERC20Token[]
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>();
    const lensOracleAddress = LENS_ORACLE_ADDRESSES[chainId];

    if (!lensOracleAddress) {
      return priceMap;
    }

    try {
      const publicClient = getPublicClient(chainId);

      // For Lens Oracle, we need to know the oracle addresses for each token
      // This is chain-specific and would typically come from a configuration
      // For now, we'll use a simplified approach with known oracle mappings
      const tokenToOracle = this.getOracleMappings(chainId);
      
      const tokensWithOracles = tokens
        .filter(token => tokenToOracle.has(token.address.toLowerCase()))
        .map(token => ({
          token,
          oracle: tokenToOracle.get(token.address.toLowerCase())!,
        }));

      if (tokensWithOracles.length === 0) {
        return priceMap;
      }

      logger.info(`Lens Oracle: Fetching ${tokensWithOracles.length} prices on chain ${chainId}`);

      // Batch fetch prices using the Lens Oracle getPrices function
      const tokenAddresses = tokensWithOracles.map(t => t.token.address as Address);
      const oracleAddresses = tokensWithOracles.map(t => t.oracle as Address);

      const prices = await publicClient.readContract({
        address: lensOracleAddress as Address,
        abi: LENS_ORACLE_ABI,
        functionName: 'getPrices',
        args: [tokenAddresses, oracleAddresses],
      }) as bigint[];

      // Process results
      let successCount = 0;
      tokensWithOracles.forEach((item, index) => {
        const price = prices[index];
        if (price && price > BigInt(0)) {
          // Lens Oracle returns prices in 18 decimals, convert to 6
          const normalizedPrice = price / BigInt(10 ** 12);
          
          priceMap.set(item.token.address.toLowerCase(), {
            address: item.token.address.toLowerCase(),
            price: normalizedPrice,
            source: 'lens-oracle',
          });
          successCount++;
        }
      });

      if (successCount > 0) {
        logger.debug(`Lens Oracle: Fetched ${successCount} prices for chain ${chainId}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message.split('\n')[0] : String(error);
      logger.warn(`Lens Oracle fetch failed for chain ${chainId}: ${errorMsg}`);
    }

    return priceMap;
  }

  private getOracleMappings(chainId: number): Map<string, string> {
    // This would typically come from a configuration file
    // For now, returning some known mappings for major tokens
    const mappings = new Map<string, string>();

    if (chainId === 1) {
      // Ethereum mainnet oracles
      mappings.set('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'); // WETH
      mappings.set('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'); // USDC
      mappings.set('0xdac17f958d2ee523a2206206994597c13d831ec7', '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D'); // USDT
      mappings.set('0x6b175474e89094c44da98b954eedeac495271d0f', '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'); // DAI
    } else if (chainId === 10) {
      // Optimism oracles
      mappings.set('0x4200000000000000000000000000000000000006', '0x13e3Ee699D1909E989722E753853AE30b17e08c5'); // WETH
      mappings.set('0x7f5c764cbc14f9669b88837ca1490cca17c31607', '0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3'); // USDC
    } else if (chainId === 137) {
      // Polygon oracles
      mappings.set('0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0'); // WMATIC
      mappings.set('0x2791bca1f2de4661ed88a30c99a7a9449aa84174', '0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7'); // USDC
    }

    return mappings;
  }
}