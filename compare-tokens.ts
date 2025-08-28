import axios from 'axios';

async function compareTokens() {
  const chains = [1, 10, 100, 137, 250, 8453, 42161];
  
  console.log('Comparing token lists between our service and ydaemon...\n');
  console.log('Chain | Our Service | ydaemon | Difference | Coverage');
  console.log('------|-------------|---------|------------|----------');
  
  let totalOurs = 0;
  let totalYdaemon = 0;
  
  for (const chainId of chains) {
    try {
      // Fetch from our service
      const ourResponse = await axios.get(`http://localhost:8080/v1/${chainId}/tokens`);
      const ourTokens = ourResponse.data.tokens || [];
      const ourAddresses = new Set(ourTokens.map((t: any) => t.address.toLowerCase()));
      
      // Fetch from ydaemon
      const ydaemonResponse = await axios.get(`https://ydaemon.yearn.fi/${chainId}/tokens/all`);
      const ydaemonTokens = ydaemonResponse.data || [];
      const ydaemonAddresses = new Set(Object.keys(ydaemonTokens).map((a: string) => a.toLowerCase()));
      
      // Calculate difference
      const difference = ydaemonAddresses.size - ourAddresses.size;
      const coverage = ((ourAddresses.size / ydaemonAddresses.size) * 100).toFixed(1);
      
      // Find missing tokens
      const missing = Array.from(ydaemonAddresses).filter(addr => !ourAddresses.has(addr));
      
      console.log(`${chainId.toString().padEnd(5)} | ${ourAddresses.size.toString().padEnd(11)} | ${ydaemonAddresses.size.toString().padEnd(7)} | ${difference.toString().padStart(10)} | ${coverage.padStart(8)}%`);
      
      // Store some missing tokens for detailed analysis
      if (missing.length > 0 && chainId === 10) {
        console.log(`\n  Sample missing tokens on chain ${chainId}:`);
        missing.slice(0, 5).forEach(addr => {
          const token = ydaemonTokens[addr] || ydaemonTokens[addr.toUpperCase()] || ydaemonTokens[`0x${addr.slice(2).toUpperCase()}`];
          if (token) {
            console.log(`    ${addr}: ${token.symbol || 'Unknown'} - ${token.name || 'Unknown'}`);
          } else {
            console.log(`    ${addr}: [Unable to get details]`);
          }
        });
        console.log(`    ... and ${missing.length - 5} more\n`);
      }
      
      totalOurs += ourAddresses.size;
      totalYdaemon += ydaemonAddresses.size;
      
    } catch (error: any) {
      console.log(`${chainId.toString().padEnd(5)} | Error: ${error.message}`);
    }
  }
  
  console.log('------|-------------|---------|------------|----------');
  console.log(`TOTAL | ${totalOurs.toString().padEnd(11)} | ${totalYdaemon.toString().padEnd(7)} | ${(totalYdaemon - totalOurs).toString().padStart(10)} | ${((totalOurs / totalYdaemon) * 100).toFixed(1).padStart(8)}%`);
  
  // Detailed comparison for Optimism
  console.log('\n\n=== Detailed Analysis for Optimism (Chain 10) ===\n');
  try {
    const ourResponse = await axios.get(`http://localhost:8080/v1/10/tokens`);
    const ourTokens = ourResponse.data.tokens || [];
    const ourAddresses = new Set(ourTokens.map((t: any) => t.address.toLowerCase()));
    
    const ydaemonResponse = await axios.get(`https://ydaemon.yearn.fi/10/tokens/all`);
    const ydaemonTokens = ydaemonResponse.data || {};
    const ydaemonAddresses = new Set(Object.keys(ydaemonTokens).map((a: string) => a.toLowerCase()));
    
    const missing = Array.from(ydaemonAddresses).filter(addr => !ourAddresses.has(addr));
    
    // Analyze missing tokens by type
    const missingAnalysis: { [key: string]: number } = {};
    missing.forEach(addr => {
      const token = ydaemonTokens[addr] || ydaemonTokens[addr.toUpperCase()] || ydaemonTokens[`0x${addr.slice(2).toUpperCase()}`];
      if (token) {
        const symbol = token.symbol || 'Unknown';
        if (symbol.includes('yvOP') || symbol.includes('yvUSDC') || symbol.includes('yvDAI')) {
          missingAnalysis['Yearn Vaults'] = (missingAnalysis['Yearn Vaults'] || 0) + 1;
        } else if (symbol.includes('CRV') || symbol.includes('Curve')) {
          missingAnalysis['Curve Related'] = (missingAnalysis['Curve Related'] || 0) + 1;
        } else if (symbol.includes('LP') || symbol.includes('UNI-V2')) {
          missingAnalysis['LP Tokens'] = (missingAnalysis['LP Tokens'] || 0) + 1;
        } else if (symbol.includes('WETH') || symbol.includes('WBTC') || symbol.includes('USDC') || symbol.includes('DAI')) {
          missingAnalysis['Major Tokens'] = (missingAnalysis['Major Tokens'] || 0) + 1;
        } else {
          missingAnalysis['Other'] = (missingAnalysis['Other'] || 0) + 1;
        }
      } else {
        missingAnalysis['Unknown'] = (missingAnalysis['Unknown'] || 0) + 1;
      }
    });
    
    console.log('Missing tokens by category:');
    Object.entries(missingAnalysis).forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });
    
  } catch (error: any) {
    console.log('Error analyzing Optimism:', error.message);
  }
}

compareTokens().catch(console.error);