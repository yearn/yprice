import { parseAbi, type Address } from 'viem';
import { ERC20Token, Price } from '../models';
import { logger, getPublicClient, batchReadContracts } from '../utils';
import { DISCOVERY_CONFIGS } from '../discovery/config';

// Sugar Oracle contract address on Optimism
const VELO_SUGAR_ORACLE_ADDRESS = '0xcA97e5653d775cA689BED5D0B4164b7656677011';

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
];

// Sugar ABI - complex tuple needs to be defined as a proper ABI object for viem
const SUGAR_ABI = [
  {
    inputs: [
      { name: 'limit', type: 'uint256' },
      { name: 'offset', type: 'uint256' }
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
          { name: 'token1_fees', type: 'uint256' }
        ],
        name: '',
        type: 'tuple[]'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

const SUGAR_ORACLE_ABI = parseAbi([
  'function getManyRatesWithConnectors(uint8 length, address[] connectors) view returns (uint256[])',
]);

const ERC20_ABI = parseAbi([
  'function decimals() view returns (uint8)',
]);

interface SugarPoolData {
  lp: string;
  symbol: string;
  decimals: number;
  liquidity: bigint;
  type: number;
  tick: number;
  sqrt_ratio: bigint;
  token0: string;
  reserve0: bigint;
  staked0: bigint;
  token1: string;
  reserve1: bigint;
  staked1: bigint;
  gauge: string;
  gauge_liquidity: bigint;
  gauge_alive: boolean;
  fee: string;
  bribe: string;
  factory: string;
  emissions: bigint;
  emissions_token: string;
  pool_fee: bigint;
  unstaked_fee: bigint;
  token0_fees: bigint;
  token1_fees: bigint;
}

export class VelodromeFetcher {
  async fetchPrices(
    chainId: number,
    _tokens: ERC20Token[],
    existingPrices: Map<string, Price>
  ): Promise<Map<string, Price>> {
    const priceMap = new Map<string, Price>();
    
    // Only support Optimism for now (can add Base later)
    if (chainId !== 10) {
      return priceMap;
    }

    const publicClient = getPublicClient(chainId);
    const config = DISCOVERY_CONFIGS[chainId];
    
    if (!config?.veloSugarAddress) {
      logger.warn(`[Velodrome] No Sugar address configured for chain ${chainId}`);
      return priceMap;
    }

    try {
      // Get all pools from Sugar contract
      const batchSize = 25;
      const maxBatches = 39; // Stop before batch 39 which fails
      const allPools: SugarPoolData[] = [];
      
      logger.info(`[Velodrome] Starting to fetch pools for chain ${chainId}`);
      
      for (let i = 0; i < maxBatches; i++) {
        try {
          const offset = i * batchSize;
          const pools = await publicClient.readContract({
            address: config.veloSugarAddress as Address,
            abi: SUGAR_ABI,
            functionName: 'all',
            args: [BigInt(batchSize), BigInt(offset)],
          }) as SugarPoolData[];
          
          if (!pools || pools.length === 0) {
            logger.debug(`[Velodrome] Batch ${i}: No more pools found`);
            break;
          }
          
          allPools.push(...pools);
          logger.debug(`[Velodrome] Batch ${i}: Fetched ${pools.length} pools (total: ${allPools.length})`);
          
          if (pools.length < batchSize) {
            break;
          }
        } catch (error) {
          if (i === 0) {
            logger.error('[Velodrome] Failed to fetch first batch from Sugar contract:', error);
            return priceMap;
          }
          logger.debug(`[Velodrome] Batch ${i} failed, stopping:`, error);
          break;
        }
      }

      if (allPools.length === 0) {
        logger.warn('[Velodrome] No pools found');
        return priceMap;
      }

      logger.info(`[Velodrome] Found ${allPools.length} pools total`);

      // Collect unique tokens from pools
      const uniqueTokens = new Set<string>();
      const lpTokens = new Set<string>();
      for (const pool of allPools) {
        lpTokens.add(pool.lp.toLowerCase());
        if (pool.token0 && pool.token0 !== '0x0000000000000000000000000000000000000000') {
          uniqueTokens.add(pool.token0.toLowerCase());
        }
        if (pool.token1 && pool.token1 !== '0x0000000000000000000000000000000000000000') {
          uniqueTokens.add(pool.token1.toLowerCase());
        }
      }
      
      logger.info(`[Velodrome] Found ${lpTokens.size} LP tokens and ${uniqueTokens.size} unique component tokens`)

      // Get prices from Sugar Oracle
      const tokenAddresses = Array.from(uniqueTokens);
      
      // Sugar Oracle expects uint8 for length, so we need to limit to 255 tokens
      // We'll process in batches if needed
      const maxTokensPerCall = 200; // Leave some room for connectors
      const tokenBatches = [];
      for (let i = 0; i < tokenAddresses.length; i += maxTokensPerCall) {
        tokenBatches.push(tokenAddresses.slice(i, i + maxTokensPerCall));
      }
      
      logger.info(`[Velodrome] Fetching prices for ${tokenAddresses.length} tokens from Sugar Oracle (${tokenBatches.length} batches)`);
      
      const allTokenPrices = new Map<string, bigint>();
      
      for (const batch of tokenBatches) {
        const connectors = [...batch, ...OPT_RATE_CONNECTORS].map(addr => addr as Address);
        
        try {
          logger.debug(`[Velodrome] Fetching batch of ${batch.length} tokens...`);
          
          // Add timeout for the Oracle call (30s since it's a heavy call)
          const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Sugar Oracle timeout after 30s')), 30000)
          );
          
          const oraclePromise = publicClient.readContract({
            address: VELO_SUGAR_ORACLE_ADDRESS as Address,
            abi: SUGAR_ORACLE_ABI,
            functionName: 'getManyRatesWithConnectors',
            args: [batch.length, connectors],
          });
          
          const tokenPrices = await Promise.race([oraclePromise, timeoutPromise]) as bigint[];
          
          // Map prices to addresses
          for (let i = 0; i < batch.length; i++) {
            const address = batch[i];
            const price = tokenPrices[i];
            if (address && price !== undefined) {
              allTokenPrices.set(address, price);
            }
          }
          
          logger.debug(`[Velodrome] Batch returned ${tokenPrices.length} prices`);
        } catch (error: any) {
          logger.error(`[Velodrome] Failed to fetch prices from Sugar Oracle: ${error.message || error}`);
          // Continue with other batches even if one fails
        }
      }
      
      logger.info(`[Velodrome] Sugar Oracle returned ${allTokenPrices.size} total prices`);

      // Create price map for tokens
      const tokenPriceMap = new Map<string, bigint>();
      let validPriceCount = 0;
      for (const [address, price] of allTokenPrices) {
        if (price !== undefined && price > BigInt(0)) {
          tokenPriceMap.set(address, price);
          validPriceCount++;
        }
      }
      logger.info(`[Velodrome] ${validPriceCount} tokens have valid prices from Oracle`)

      // Special case for USDC (treat as $1 if no price)
      const usdcAddress = '0x7f5c764cbc14f9669b88837ca1490cca17c31607';
      const usdcPrice = tokenPriceMap.get(usdcAddress);
      if (!usdcPrice || usdcPrice === BigInt(0)) {
        tokenPriceMap.set(usdcAddress, BigInt(10) ** BigInt(18)); // $1 in 18 decimals
      }

      // CRITICAL OPTIMIZATION: Use multicall to fetch all decimals at once
      logger.info(`[Velodrome] Fetching decimals for ${uniqueTokens.size} tokens using multicall`);
      
      const decimalsContracts = Array.from(uniqueTokens).map(address => ({
        address: address as Address,
        abi: ERC20_ABI,
        functionName: 'decimals',
        args: [],
      }));

      // Batch the decimals calls (viem will use multicall automatically)
      const decimalsResults = await batchReadContracts<number>(chainId, decimalsContracts);
      
      const tokenDecimals = new Map<string, number>();
      let decimalsFetched = 0;
      
      Array.from(uniqueTokens).forEach((address, index) => {
        const result = decimalsResults[index];
        if (result && result.status === 'success' && result.result !== undefined) {
          tokenDecimals.set(address, Number(result.result));
          decimalsFetched++;
        } else {
          tokenDecimals.set(address, 18); // Default to 18
        }
      });
      
      logger.info(`[Velodrome] Fetched decimals for ${decimalsFetched}/${uniqueTokens.size} tokens via multicall`)

      // Calculate LP token prices
      let lpPricesCalculated = 0;
      let lpSkippedNoPrice = 0;
      let lpSkippedNoLiquidity = 0;
      
      for (const pool of allPools) {
        const token0Price = tokenPriceMap.get(pool.token0.toLowerCase()) || BigInt(0);
        const token1Price = tokenPriceMap.get(pool.token1.toLowerCase()) || BigInt(0);
        
        if (token0Price === BigInt(0) || token1Price === BigInt(0)) {
          lpSkippedNoPrice++;
          continue;
        }

        const token0Decimals = tokenDecimals.get(pool.token0.toLowerCase()) || 18;
        const token1Decimals = tokenDecimals.get(pool.token1.toLowerCase()) || 18;

        // Calculate value in pool
        // Value = (token0_price * reserve0 / 10^token0_decimals) + (token1_price * reserve1 / 10^token1_decimals)
        const token0Divisor = BigInt(10) ** BigInt(token0Decimals);
        const token1Divisor = BigInt(10) ** BigInt(token1Decimals);
        const token0Value = token0Divisor > 0 ? (token0Price * pool.reserve0) / token0Divisor : BigInt(0);
        const token1Value = token1Divisor > 0 ? (token1Price * pool.reserve1) / token1Divisor : BigInt(0);
        const totalValue = token0Value + token1Value;

        // Calculate LP price = total_value / liquidity * 10^6 (for 6 decimal price format)
        if (pool.liquidity > BigInt(0)) {
          // LP has 18 decimals, we want price in 6 decimals
          // price = totalValue * 10^6 * 10^18 / liquidity / 10^18 = totalValue * 10^6 / liquidity
          const lpPrice = (totalValue * BigInt(10 ** 6) * BigInt(10 ** 18)) / pool.liquidity / BigInt(10 ** 18);
          
          if (lpPrice > BigInt(0)) {
            priceMap.set(pool.lp.toLowerCase(), {
              address: pool.lp.toLowerCase(),
              price: lpPrice,
              source: 'velodrome',
            });
            lpPricesCalculated++;
          }
        } else {
          lpSkippedNoLiquidity++;
        }

        // Also add prices for component tokens if we don't have them yet
        if (!existingPrices.has(pool.token0.toLowerCase()) && token0Price > BigInt(0)) {
          const price0 = (token0Price * BigInt(10 ** 6)) / BigInt(10 ** 18);
          priceMap.set(pool.token0.toLowerCase(), {
            address: pool.token0.toLowerCase(),
            price: price0,
            source: 'velodrome-oracle',
          });
        }

        if (!existingPrices.has(pool.token1.toLowerCase()) && token1Price > BigInt(0)) {
          const price1 = (token1Price * BigInt(10 ** 6)) / BigInt(10 ** 18);
          priceMap.set(pool.token1.toLowerCase(), {
            address: pool.token1.toLowerCase(),
            price: price1,
            source: 'velodrome-oracle',
          });
        }
      }

      logger.info(`[Velodrome] Summary:`);
      logger.info(`  - LP prices calculated: ${lpPricesCalculated}`);
      logger.info(`  - LP skipped (no component price): ${lpSkippedNoPrice}`);
      logger.info(`  - LP skipped (no liquidity): ${lpSkippedNoLiquidity}`);
      logger.info(`  - Total prices returned: ${priceMap.size}`);
    } catch (error) {
      logger.error(`Velodrome fetcher failed for chain ${chainId}:`, error);
    }

    return priceMap;
  }
}