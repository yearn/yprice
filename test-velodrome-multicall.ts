import dotenv from 'dotenv';
import { VelodromeFetcher } from './src/fetchers/velodrome';
import { logger } from './src/utils';

dotenv.config();

async function testVelodromeMulticall() {
  console.log('Testing Velodrome fetcher with multicall decimals...\n');
  
  const fetcher = new VelodromeFetcher();
  const startTime = Date.now();
  
  try {
    // Test on Optimism (chain 10)
    const prices = await fetcher.fetchPrices(10, [], new Map());
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n=== Results ===`);
    console.log(`Time taken: ${elapsed} seconds`);
    console.log(`Prices fetched: ${prices.size}`);
    
    // Show some sample prices
    const samples = Array.from(prices.entries()).slice(0, 5);
    console.log('\nSample prices:');
    samples.forEach(([address, priceData]) => {
      console.log(`  ${address.slice(0, 10)}... : $${(Number(priceData.price) / 1e6).toFixed(4)} (${priceData.source})`);
    });
    
    // Count LP vs regular tokens
    let lpCount = 0;
    let tokenCount = 0;
    prices.forEach((price) => {
      if (price.source === 'velodrome') {
        lpCount++;
      } else {
        tokenCount++;
      }
    });
    
    console.log(`\nBreakdown:`);
    console.log(`  LP tokens: ${lpCount}`);
    console.log(`  Regular tokens: ${tokenCount}`);
    
    if (elapsed < '30' && prices.size > 500) {
      console.log('\n✅ SUCCESS: Multicall optimization working! Fast execution with many prices.');
    } else if (prices.size > 100) {
      console.log('\n⚠️  PARTIAL: Got prices but could be faster or more complete.');
    } else {
      console.log('\n❌ ISSUE: Not enough prices returned.');
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testVelodromeMulticall().catch(console.error);