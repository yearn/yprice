import tokenDiscoveryService from './src/discovery/tokenDiscoveryService';
import axios from 'axios';

async function compareServices() {
  console.log('Starting token discovery comparison...\n');
  
  // Discover all tokens from our service
  console.log('Discovering tokens with our service (this will take a moment)...');
  const tokensByChain = await tokenDiscoveryService.discoverAllTokens(true);
  
  const chains = [1, 10, 100, 137, 250, 8453, 42161];
  
  console.log('\n=== Token Count Comparison ===\n');
  console.log('Chain | Our Service | ydaemon | Difference | Coverage');
  console.log('------|-------------|---------|------------|----------');
  
  let totalOurs = 0;
  let totalYdaemon = 0;
  const missingByChain: Map<number, string[]> = new Map();
  
  for (const chainId of chains) {
    try {
      // Get our tokens
      const ourTokens = tokensByChain.get(chainId) || [];
      const ourAddresses = new Set(ourTokens.map(t => t.address.toLowerCase()));
      
      // Get ydaemon tokens
      const ydaemonResponse = await axios.get(`https://ydaemon.yearn.fi/${chainId}/tokens/all`);
      const ydaemonTokens = ydaemonResponse.data || {};
      const ydaemonAddresses = new Set(Object.keys(ydaemonTokens).map((a: string) => a.toLowerCase()));
      
      // Calculate difference
      const difference = ydaemonAddresses.size - ourAddresses.size;
      const coverage = ydaemonAddresses.size > 0 
        ? ((ourAddresses.size / ydaemonAddresses.size) * 100).toFixed(1) 
        : '100.0';
      
      // Find missing tokens
      const missing = Array.from(ydaemonAddresses).filter(addr => !ourAddresses.has(addr));
      missingByChain.set(chainId, missing);
      
      console.log(`${chainId.toString().padEnd(5)} | ${ourAddresses.size.toString().padEnd(11)} | ${ydaemonAddresses.size.toString().padEnd(7)} | ${difference.toString().padStart(10)} | ${coverage.padStart(8)}%`);
      
      totalOurs += ourAddresses.size;
      totalYdaemon += ydaemonAddresses.size;
      
    } catch (error: any) {
      console.log(`${chainId.toString().padEnd(5)} | Error: ${error.message}`);
    }
  }
  
  console.log('------|-------------|---------|------------|----------');
  const totalCoverage = totalYdaemon > 0 
    ? ((totalOurs / totalYdaemon) * 100).toFixed(1) 
    : '100.0';
  console.log(`TOTAL | ${totalOurs.toString().padEnd(11)} | ${totalYdaemon.toString().padEnd(7)} | ${(totalYdaemon - totalOurs).toString().padStart(10)} | ${totalCoverage.padStart(8)}%`);
  
  // Detailed analysis for Optimism
  console.log('\n\n=== Detailed Analysis for Optimism (Chain 10) ===\n');
  const optimismMissing = missingByChain.get(10) || [];
  
  if (optimismMissing.length > 0) {
    try {
      const ydaemonResponse = await axios.get(`https://ydaemon.yearn.fi/10/tokens/all`);
      const ydaemonTokens = ydaemonResponse.data || {};
      
      // Analyze missing tokens by type
      const missingAnalysis: { [key: string]: string[] } = {};
      
      optimismMissing.forEach(addr => {
        const token = ydaemonTokens[addr] || ydaemonTokens[addr.toUpperCase()] || ydaemonTokens[`0x${addr.slice(2).toUpperCase()}`];
        if (token) {
          const symbol = token.symbol || 'Unknown';
          const category = categorizeToken(symbol, token.name || '');
          
          if (!missingAnalysis[category]) {
            missingAnalysis[category] = [];
          }
          missingAnalysis[category].push(`${addr.slice(0, 10)}... ${symbol}`);
        }
      });
      
      console.log('Missing tokens by category:');
      Object.entries(missingAnalysis).forEach(([category, tokens]) => {
        console.log(`\n${category}: ${tokens.length} tokens`);
        if (tokens.length <= 5) {
          tokens.forEach(t => console.log(`  - ${t}`));
        } else {
          tokens.slice(0, 5).forEach(t => console.log(`  - ${t}`));
          console.log(`  ... and ${tokens.length - 5} more`);
        }
      });
    } catch (error) {
      console.log('Error analyzing Optimism:', error);
    }
  } else {
    console.log('✅ No missing tokens on Optimism!');
  }
  
  // Show discovery sources
  console.log('\n\n=== Discovery Sources Used ===\n');
  const counts = tokenDiscoveryService.getChainTokenCounts();
  Object.entries(counts).forEach(([chainId, count]) => {
    console.log(`Chain ${chainId}: ${count} tokens discovered`);
  });
}

function categorizeToken(symbol: string, name: string): string {
  const s = symbol.toUpperCase();
  const n = name.toUpperCase();
  
  if (s.includes('YV') || n.includes('YEARN')) return 'Yearn Vaults';
  if (s.includes('CRV') || s.includes('CURVE') || n.includes('CURVE')) return 'Curve Related';
  if (s.includes('-LP') || s.includes('UNI-V2') || s.includes('VELO') || s.includes('AERO')) return 'LP Tokens';
  if (s.includes('AAVE') || n.includes('AAVE')) return 'AAVE Tokens';
  if (['WETH', 'WBTC', 'USDC', 'USDT', 'DAI', 'FRAX'].includes(s)) return 'Major Tokens';
  if (s.startsWith('S') && (s.includes('USD') || s.includes('ETH') || s.includes('BTC'))) return 'Synths';
  return 'Other';
}

compareServices().catch(console.error);