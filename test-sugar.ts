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

async function test() {
  try {
    const publicClient = createPublicClient({
      chain: optimism,
      transport: http(RPC_URL),
    });
    
    console.log('Testing Sugar contract at:', SUGAR_ADDRESS);
    console.log('RPC URL:', RPC_URL);
    console.log('Chain ID:', optimism.id);
    
    const pools = await publicClient.readContract({
      address: SUGAR_ADDRESS as Address,
      abi: SUGAR_ABI,
      functionName: 'all',
      args: [BigInt(5), BigInt(0)],
    });
    
    console.log('✅ Successfully fetched', pools.length, 'pools from Sugar contract');
    
    if (pools.length > 0) {
      const firstPool = pools[0];
      console.log('\nFirst pool details:');
      console.log('  LP:', firstPool.lp);
      console.log('  Symbol:', firstPool.symbol);
      console.log('  Token0:', firstPool.token0);
      console.log('  Token1:', firstPool.token1);
      console.log('  Liquidity:', firstPool.liquidity?.toString());
      console.log('  Gauge:', firstPool.gauge);
      
      // Count unique tokens
      const uniqueTokens = new Set();
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
      console.log('\nUnique tokens found in', pools.length, 'pools:', uniqueTokens.size);
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('Details:', error);
  }
}

test();