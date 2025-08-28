import { VeloDiscovery } from './src/discovery/veloDiscovery';
import { DISCOVERY_CONFIGS } from './src/discovery/config';
import dotenv from 'dotenv';

dotenv.config();

async function testVeloDiscovery() {
  console.log('Testing Velodrome discovery with API and Sugar fallback...\n');
  
  const chainId = 10;
  const config = DISCOVERY_CONFIGS[chainId];
  if (!config) {
    console.log('No config for chain', chainId);
    return;
  }
  const rpcUrl = process.env.RPC_URI_FOR_10;
  
  console.log('Chain:', chainId);
  console.log('Sugar Address:', config.veloSugarAddress);
  console.log('API URL:', config.veloApiUrl);
  console.log('RPC URL:', rpcUrl ? 'Present' : 'Missing');
  
  // Test with both API and Sugar
  console.log('\n=== Test 1: With API and Sugar ===');
  const discovery1 = new VeloDiscovery(
    chainId,
    config.veloSugarAddress,
    config.veloApiUrl,
    rpcUrl
  );
  
  const tokens1 = await discovery1.discoverTokens();
  console.log('Tokens discovered:', tokens1.length);
  
  // Test with only Sugar (no API)
  console.log('\n=== Test 2: Sugar only (no API) ===');
  const discovery2 = new VeloDiscovery(
    chainId,
    config.veloSugarAddress,
    undefined, // No API
    rpcUrl
  );
  
  const tokens2 = await discovery2.discoverTokens();
  console.log('Tokens discovered:', tokens2.length);
  
  // Check unique addresses
  const unique1 = new Set(tokens1.map(t => t.address.toLowerCase()));
  const unique2 = new Set(tokens2.map(t => t.address.toLowerCase()));
  
  console.log('\n=== Summary ===');
  console.log('With API + Sugar:', unique1.size, 'unique tokens');
  console.log('Sugar only:', unique2.size, 'unique tokens');
  
  if (unique1.size === 0 && unique2.size > 0) {
    console.log('\n⚠️  API is failing and Sugar fallback is not working!');
  } else if (unique2.size > unique1.size) {
    console.log('\n⚠️  Sugar discovers more tokens than API+Sugar combined!');
  } else {
    console.log('\n✅ Discovery is working correctly');
  }
}

testVeloDiscovery().catch(console.error);