import { VelodromeFetcher } from './dist/fetchers/velodrome.js';

async function test() {
  const fetcher = new VelodromeFetcher();
  const prices = await fetcher.fetchPrices(10, [], new Map());
  console.log('Velodrome returned', prices.size, 'prices for Optimism');
}

test().catch(console.error);