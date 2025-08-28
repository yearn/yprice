import axios from 'axios';
import fs from 'fs';

async function detailedAnalysis() {
  console.log('Fetching detailed analysis of missing tokens on Optimism (Chain 10)...\n');
  
  try {
    // Fetch from our service
    const ourResponse = await axios.get(`http://localhost:8080/prices/10/all`);
    const ourPrices = ourResponse.data || {};
    
    // Fetch from ydaemon prices
    const ydaemonPriceResponse = await axios.get(`https://ydaemon.yearn.fi/10/prices/all`);
    const ydaemonPrices = ydaemonPriceResponse.data || {};
    
    // Fetch ydaemon token details
    const ydaemonTokenResponse = await axios.get(`https://ydaemon.yearn.fi/10/tokens/all`);
    const ydaemonTokens = ydaemonTokenResponse.data || {};
    
    const ourAddresses = new Set(Object.keys(ourPrices).map(a => a.toLowerCase()));
    const ydaemonPriceAddresses = new Set(Object.keys(ydaemonPrices).map(a => a.toLowerCase()));
    
    // Find missing tokens (in ydaemon prices but not in ours)
    const missingAddresses = Array.from(ydaemonPriceAddresses).filter(addr => !ourAddresses.has(addr));
    
    console.log(`Our service: ${ourAddresses.size} tokens with prices`);
    console.log(`ydaemon: ${ydaemonPriceAddresses.size} tokens with prices`);
    console.log(`Missing: ${missingAddresses.length} tokens\n`);
    
    // Create detailed list of missing tokens
    const missingTokenDetails = [];
    
    for (const addr of missingAddresses) {
      const price = ydaemonPrices[addr] || ydaemonPrices[addr.toUpperCase()] || ydaemonPrices[`0x${addr.slice(2).toUpperCase()}`];
      const token = ydaemonTokens[addr] || ydaemonTokens[addr.toUpperCase()] || ydaemonTokens[`0x${addr.slice(2).toUpperCase()}`];
      
      if (token) {
        missingTokenDetails.push({
          address: addr,
          symbol: token.symbol || 'Unknown',
          name: token.name || 'Unknown',
          decimals: token.decimals || 0,
          price: price || '0',
          type: categorizeToken(token.symbol || '', token.name || '')
        });
      } else {
        missingTokenDetails.push({
          address: addr,
          symbol: 'Unknown',
          name: 'Unknown',
          decimals: 0,
          price: price || '0',
          type: 'Unknown'
        });
      }
    }
    
    // Sort by price (highest first)
    missingTokenDetails.sort((a, b) => {
      const priceA = parseFloat(a.price) || 0;
      const priceB = parseFloat(b.price) || 0;
      return priceB - priceA;
    });
    
    // Group by type
    const byType: { [key: string]: any[] } = {};
    for (const token of missingTokenDetails) {
      if (!byType[token.type]) {
        byType[token.type] = [];
      }
      byType[token.type]!.push(token);
    }
    
    // Print summary
    console.log('=== Missing Tokens by Category ===\n');
    for (const [type, tokens] of Object.entries(byType)) {
      console.log(`${type}: ${tokens.length} tokens`);
    }
    
    console.log('\n=== Top 50 Missing Tokens by Value ===\n');
    console.log('Address                                      Symbol          Price          Type');
    console.log('-------------------------------------------- --------------- -------------- ----------------');
    
    for (const token of missingTokenDetails.slice(0, 50)) {
      const price = parseFloat(token.price) || 0;
      const priceStr = price > 1000000 ? `$${(price/1000000).toFixed(2)}M` : 
                       price > 1000 ? `$${(price/1000).toFixed(2)}K` : 
                       `$${price.toFixed(2)}`;
      
      console.log(
        `${token.address.padEnd(44)} ${token.symbol.slice(0, 15).padEnd(15)} ${priceStr.padStart(14)} ${token.type}`
      );
    }
    
    // Save full list to file
    const output = {
      summary: {
        ourServiceCount: ourAddresses.size,
        ydaemonCount: ydaemonPriceAddresses.size,
        missingCount: missingAddresses.length,
        coverage: ((ourAddresses.size / ydaemonPriceAddresses.size) * 100).toFixed(2) + '%'
      },
      byCategory: Object.fromEntries(
        Object.entries(byType).map(([type, tokens]) => [type, tokens.length])
      ),
      missingTokens: missingTokenDetails
    };
    
    fs.writeFileSync('missing-tokens-optimism.json', JSON.stringify(output, null, 2));
    console.log('\n✅ Full analysis saved to missing-tokens-optimism.json');
    
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

function categorizeToken(symbol: string, name: string): string {
  const s = symbol.toUpperCase();
  const n = name.toUpperCase();
  
  // Special tokens
  if (s === 'ETH' || s === 'WETH') return 'ETH/WETH';
  if (s === 'OP') return 'OP Token';
  
  // LP tokens
  if (s.includes('VELO-V') || s.includes('VELO-LP')) return 'Velodrome LP';
  if (s.includes('SAMMV') || s.includes('VAMMV') || s.includes('AMMV')) return 'Velodrome LP';
  if (n.includes('VELODROME')) return 'Velodrome LP';
  
  // Yearn vaults
  if (s.startsWith('YV')) return 'Yearn Vaults';
  
  // Major tokens
  if (['USDC', 'USDT', 'DAI', 'FRAX', 'WBTC', 'VELO', 'SNX'].includes(s)) return 'Major Tokens';
  
  // Stablecoins
  if (s.includes('USD') || s.includes('USDC') || s.includes('USDT') || s.includes('DAI')) return 'Stablecoins';
  
  // Curve related
  if (s.includes('CRV') || n.includes('CURVE')) return 'Curve Related';
  
  // AAVE tokens
  if (s.startsWith('A') && (s.includes('USDC') || s.includes('DAI') || s.includes('WETH'))) return 'AAVE Tokens';
  
  // Wrapped tokens
  if (s.startsWith('W') && !s.includes('VELO')) return 'Wrapped Assets';
  
  // Governance tokens
  if (['VELO', 'AERO', 'CRV', 'BAL', 'SUSHI'].includes(s)) return 'Governance Tokens';
  
  return 'Other';
}

detailedAnalysis().catch(console.error);