import axios from 'axios';

async function comparePrices() {
  const chains = [1, 10, 100, 137, 250, 8453, 42161];
  
  console.log('Comparing pricing responses between our service and ydaemon...\n');
  
  // Start our service first
  console.log('Please ensure the service is running on port 8080\n');
  
  for (const chainId of chains) {
    console.log(`\n=== Chain ${chainId} ===`);
    
    try {
      // Fetch from our service
      let ourTokens: any = {};
      try {
        const ourResponse = await axios.get(`http://localhost:8080/prices/${chainId}/all`);
        ourTokens = ourResponse.data || {};
      } catch (error: any) {
        console.log(`Our service error: ${error.message}`);
      }
      
      // Fetch from ydaemon
      let ydaemonTokens: any = {};
      try {
        const ydaemonResponse = await axios.get(`https://ydaemon.yearn.fi/${chainId}/prices/all`);
        ydaemonTokens = ydaemonResponse.data || {};
      } catch (error: any) {
        console.log(`ydaemon error: ${error.message}`);
        continue;
      }
      
      const ourAddresses = new Set(Object.keys(ourTokens).map(a => a.toLowerCase()));
      const ydaemonAddresses = new Set(Object.keys(ydaemonTokens).map(a => a.toLowerCase()));
      
      // Find missing tokens (in ydaemon but not in ours)
      const missingAddresses = Array.from(ydaemonAddresses).filter(addr => !ourAddresses.has(addr));
      
      console.log(`Our service: ${ourAddresses.size} tokens with prices`);
      console.log(`ydaemon: ${ydaemonAddresses.size} tokens with prices`);
      console.log(`Missing: ${missingAddresses.length} tokens`);
      
      if (missingAddresses.length > 0 && missingAddresses.length <= 20) {
        console.log('\nMissing tokens:');
        for (const addr of missingAddresses) {
          const price = ydaemonTokens[addr] || ydaemonTokens[addr.toUpperCase()];
          console.log(`  ${addr}: $${price}`);
        }
      } else if (missingAddresses.length > 20) {
        console.log('\nFirst 20 missing tokens:');
        for (const addr of missingAddresses.slice(0, 20)) {
          const price = ydaemonTokens[addr] || ydaemonTokens[addr.toUpperCase()];
          console.log(`  ${addr}: $${price}`);
        }
        console.log(`  ... and ${missingAddresses.length - 20} more`);
      }
      
      // Calculate coverage
      const coverage = ydaemonAddresses.size > 0 
        ? ((ourAddresses.size / ydaemonAddresses.size) * 100).toFixed(1)
        : '100.0';
      console.log(`Coverage: ${coverage}%`);
      
    } catch (error: any) {
      console.log(`Error comparing chain ${chainId}: ${error.message}`);
    }
  }
  
  // Detailed comparison for Optimism
  console.log('\n\n=== Detailed Optimism (Chain 10) Comparison ===\n');
  
  try {
    const ourResponse = await axios.get(`http://localhost:8080/prices/10/all`);
    const ourTokens = ourResponse.data || {};
    
    const ydaemonResponse = await axios.get(`https://ydaemon.yearn.fi/10/prices/all`);
    const ydaemonTokens = ydaemonResponse.data || {};
    
    // Also fetch token details from ydaemon to understand what's missing
    const ydaemonTokenDetails = await axios.get(`https://ydaemon.yearn.fi/10/tokens/all`);
    const tokenDetails = ydaemonTokenDetails.data || {};
    
    const ourAddresses = new Set(Object.keys(ourTokens).map(a => a.toLowerCase()));
    const ydaemonAddresses = new Set(Object.keys(ydaemonTokens).map(a => a.toLowerCase()));
    
    const missingAddresses = Array.from(ydaemonAddresses).filter(addr => !ourAddresses.has(addr));
    
    // Group missing tokens by type
    const missingByType: { [key: string]: any[] } = {};
    
    for (const addr of missingAddresses) {
      const token = tokenDetails[addr] || tokenDetails[addr.toUpperCase()] || tokenDetails[`0x${addr.slice(2).toUpperCase()}`];
      const price = ydaemonTokens[addr] || ydaemonTokens[addr.toUpperCase()];
      
      if (token) {
        const type = categorizeToken(token.symbol || '', token.name || '');
        if (!missingByType[type]) {
          missingByType[type] = [];
        }
        missingByType[type].push({
          address: addr,
          symbol: token.symbol,
          name: token.name,
          price: price
        });
      } else {
        if (!missingByType['Unknown']) {
          missingByType['Unknown'] = [];
        }
        missingByType['Unknown'].push({
          address: addr,
          symbol: 'Unknown',
          name: 'Unknown',
          price: price
        });
      }
    }
    
    console.log(`Total missing tokens: ${missingAddresses.length}\n`);
    
    for (const [type, tokens] of Object.entries(missingByType)) {
      console.log(`${type}: ${tokens.length} tokens`);
      const sorted = tokens.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
      for (const token of sorted.slice(0, 5)) {
        console.log(`  ${token.address.slice(0, 10)}... ${token.symbol.padEnd(10)} $${parseFloat(token.price).toFixed(2)}`);
      }
      if (tokens.length > 5) {
        console.log(`  ... and ${tokens.length - 5} more`);
      }
      console.log();
    }
    
  } catch (error: any) {
    console.log('Error in detailed comparison:', error.message);
  }
}

function categorizeToken(symbol: string, name: string): string {
  const s = symbol.toUpperCase();
  const n = name.toUpperCase();
  
  if (s.includes('YV') || n.includes('YEARN')) return 'Yearn Vaults';
  if (s.includes('VELO-V') || s.includes('SAMMV') || s.includes('VAMMV')) return 'Velodrome LP';
  if (s.includes('CRV') || s.includes('CURVE') || n.includes('CURVE')) return 'Curve Related';
  if (s.includes('AAVE') || s.startsWith('A') && (s.includes('USDC') || s.includes('DAI') || s.includes('WETH'))) return 'AAVE Tokens';
  if (['WETH', 'WBTC', 'USDC', 'USDT', 'DAI', 'FRAX', 'OP', 'VELO'].includes(s)) return 'Major Tokens';
  if (s.includes('USD') || s.includes('ETH') || s.includes('BTC')) return 'Stablecoins/Wrapped';
  return 'Other';
}

comparePrices().catch(console.error);