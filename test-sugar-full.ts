import { ethers } from 'ethers';

const SUGAR_ADDRESS = '0x3e532BC1998584fe18e357B5187897ad0110ED3A';
const RPC_URL = process.env.RPC_URI_FOR_10 || 'https://optimism.gateway.tenderly.co/1ZwsLMvEIhxbExt4w109Ur';

const SUGAR_ABI = [
  'function all(uint256 limit, uint256 offset) view returns (tuple(address lp, string symbol, uint8 decimals, uint256 liquidity, int24 type, int24 tick, uint160 sqrt_ratio, address token0, uint256 reserve0, uint256 staked0, address token1, uint256 reserve1, uint256 staked1, address gauge, uint256 gauge_liquidity, bool gauge_alive, address fee, address bribe, address factory, uint256 emissions, address emissions_token, uint256 pool_fee, uint256 unstaked_fee, uint256 token0_fees, uint256 token1_fees)[])',
];

async function discoverAllTokens() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const sugar = new ethers.Contract(SUGAR_ADDRESS, SUGAR_ABI, provider);
    
    console.log('Discovering all tokens from Sugar contract...');
    console.log('Chain ID:', await provider.getNetwork().then(n => n.chainId));
    
    const uniqueTokens = new Set<string>();
    const batchSize = 25;
    let totalPools = 0;
    
    for (let i = 0; i < 50; i++) {
      try {
        const offset = i * batchSize;
        const pools = await (sugar as any).all(batchSize, offset);
        
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