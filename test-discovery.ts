import { VeloDiscovery } from './src/discovery/veloDiscovery';
import dotenv from 'dotenv';

dotenv.config();

async function testDiscovery() {
  const rpcUrl = process.env.RPC_URI_FOR_10 || 'https://optimism.gateway.tenderly.co/1ZwsLMvEIhxbExt4w109Ur';
  const sugarAddress = '0x3e532BC1998584fe18e357B5187897ad0110ED3A';
  
  console.log('Testing Velodrome discovery on Optimism...');
  console.log('Sugar address:', sugarAddress);
  console.log('RPC URL:', rpcUrl);
  
  const discovery = new VeloDiscovery(10, sugarAddress, undefined, rpcUrl);
  
  const startTime = Date.now();
  const tokens = await discovery.discoverTokens();
  const elapsed = Date.now() - startTime;
  
  console.log('\n=== Results ===');
  console.log('Total tokens discovered:', tokens.length);
  console.log('Unique addresses:', new Set(tokens.map(t => t.address.toLowerCase())).size);
  console.log('Time elapsed:', (elapsed / 1000).toFixed(2), 'seconds');
  
  // Show some sample tokens
  console.log('\nSample tokens:');
  tokens.slice(0, 5).forEach(t => {
    console.log(`  ${t.address} (${t.source})`);
  });
}

testDiscovery().catch(console.error);