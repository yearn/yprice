import { ethers } from 'ethers';

const SUGAR_ADDRESS = '0x3e532BC1998584fe18e357B5187897ad0110ED3A';
const RPC_URL = process.env.RPC_URI_FOR_10 || 'https://optimism.gateway.tenderly.co/1ZwsLMvEIhxbExt4w109Ur';

const SUGAR_ABI = [
  'function all(uint256 limit, uint256 offset) view returns (tuple(address lp, string symbol, uint8 decimals, uint256 liquidity, int24 type, int24 tick, uint160 sqrt_ratio, address token0, uint256 reserve0, uint256 staked0, address token1, uint256 reserve1, uint256 staked1, address gauge, uint256 gauge_liquidity, bool gauge_alive, address fee, address bribe, address factory, uint256 emissions, address emissions_token, uint256 pool_fee, uint256 unstaked_fee, uint256 token0_fees, uint256 token1_fees)[])',
];

async function test() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const sugar = new ethers.Contract(SUGAR_ADDRESS, SUGAR_ABI, provider);
    
    console.log('Testing Sugar contract at:', SUGAR_ADDRESS);
    console.log('RPC URL:', RPC_URL);
    console.log('Chain ID:', await provider.getNetwork().then(n => n.chainId));
    
    const pools = await (sugar as any).all(5, 0);
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