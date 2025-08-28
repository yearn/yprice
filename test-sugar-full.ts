import { createPublicClient, http, type Address } from 'viem';
import { optimism } from 'viem/chains';

const SUGAR_ADDRESS = '0x3e532BC1998584fe18e357B5187897ad0110ED3A';
const RPC_URL = process.env.RPC_URI_FOR_10 || 'https://optimism.gateway.tenderly.co/1ZwsLMvEIhxbExt4w109Ur';

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

async function discoverAllTokens() {
  try {
    const publicClient = createPublicClient({
      chain: optimism,
      transport: http(RPC_URL),
    });
    
    console.log('Discovering all tokens from Sugar contract...');
    console.log('Chain ID:', optimism.id);
    
    const uniqueTokens = new Set<string>();
    const batchSize = 25;
    let totalPools = 0;
    
    for (let i = 0; i < 50; i++) {
      try {
        const offset = i * batchSize;
        const pools = await publicClient.readContract({
          address: SUGAR_ADDRESS as Address,
          abi: SUGAR_ABI,
          functionName: 'all',
          args: [BigInt(batchSize), BigInt(offset)],
        });
        
        if (pools.length === 0) {
          console.log(`No more pools after batch ${i}`);
          break;
        }
        
        totalPools += pools.length;
        
        for (const pool of pools) {
          if (pool.lp && pool.lp !== '0x0000000000000000000000000000000000000000') {
            uniqueTokens.add(pool.lp.toLowerCase());
          }
          if (pool.token0 && pool.token0 !== '0x0000000000000000000000000000000000000000') {
            uniqueTokens.add(pool.token0.toLowerCase());
          }
          if (pool.token1 && pool.token1 !== '0x0000000000000000000000000000000000000000') {
            uniqueTokens.add(pool.token1.toLowerCase());
          }
        }
        
        console.log(`Batch ${i}: Found ${pools.length} pools, Total unique tokens: ${uniqueTokens.size}`);
        
        if (pools.length < batchSize) {
          console.log(`Last batch had only ${pools.length} pools`);
          break;
        }
      } catch (error: any) {
        console.log(`Batch ${i} failed:`, error.message);
        break;
      }
    }
    
    console.log('\n=== Final Results ===');
    console.log('Total pools discovered:', totalPools);
    console.log('Total unique tokens:', uniqueTokens.size);
    console.log('\nTarget: ~1,142 tokens (from ydaemon)');
    console.log('Coverage:', Math.round((uniqueTokens.size / 1142) * 100) + '%');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('Details:', error);
  }
}

discoverAllTokens();