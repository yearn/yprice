#!/usr/bin/env node

const https = require('https');
const http = require('http');
const fs = require('fs');

const LOCAL_API_URL = 'http://localhost:3000/api/prices';
const YDAEMON_API_URL = 'https://ydaemon.yearn.fi/prices/all';

const CHAIN_NAMES = {
  1: 'Ethereum',
  10: 'Optimism',
  100: 'Gnosis',
  137: 'Polygon',
  146: 'Sonic',
  250: 'Fantom',
  8453: 'Base',
  42161: 'Arbitrum',
  747474: 'Katana'
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function calculatePercentageDiff(localPrice, ydaemonPrice) {
  // Convert to numbers if they're strings
  const numLocal = typeof localPrice === 'string' ? parseFloat(localPrice) : localPrice;
  const numYdaemon = typeof ydaemonPrice === 'string' ? parseFloat(ydaemonPrice) : ydaemonPrice;
  
  // Handle invalid values
  if (isNaN(numLocal) || isNaN(numYdaemon)) return 0;
  
  if (numYdaemon === 0) return numLocal === 0 ? 0 : 100;
  return ((numLocal - numYdaemon) / numYdaemon * 100);
}

function formatPrice(price) {
  // Convert to number if it's a string
  const numPrice = typeof price === 'string' ? parseFloat(price) : price;
  
  // Handle invalid values
  if (isNaN(numPrice) || numPrice === null || numPrice === undefined) {
    return 'N/A';
  }
  
  if (numPrice >= 1) return numPrice.toFixed(2);
  if (numPrice >= 0.01) return numPrice.toFixed(4);
  if (numPrice >= 0.0001) return numPrice.toFixed(6);
  return numPrice.toExponential(2);
}

async function main() {
  console.log('Fetching price data from both sources...\n');

  const [localPrices, ydaemonPrices] = await Promise.all([
    fetchJSON(LOCAL_API_URL).catch(() => ({})),
    fetchJSON(YDAEMON_API_URL).catch(() => ({}))
  ]);

  const results = {
    timestamp: new Date().toISOString(),
    summary: {
      totalComparisons: 0,
      largeDiscrepancies: 0,
      missingInLocal: 0,
      missingInYdaemon: 0
    },
    chains: {},
    discrepancies: []
  };

  console.log('=====================================');
  console.log('PRICE COMPARISON REPORT');
  console.log('=====================================\n');

  // Compare prices for each chain
  const allChains = new Set([...Object.keys(localPrices), ...Object.keys(ydaemonPrices)]);
  
  for (const chainId of [...allChains].sort((a, b) => Number(a) - Number(b))) {
    const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`;
    const localTokens = localPrices[chainId] || {};
    const ydaemonTokens = ydaemonPrices[chainId] || {};
    
    console.log(`\n${chainName} (${chainId}):`);
    console.log('─'.repeat(50));
    console.log(`Analyzing ${Object.keys(localTokens).length} local tokens and ${Object.keys(ydaemonTokens).length} ydaemon tokens`);
    
    const localTokenSet = new Set(Object.keys(localTokens).map(t => t.toLowerCase()));
    const ydaemonTokenSet = new Set(Object.keys(ydaemonTokens).map(t => t.toLowerCase()));
    const allTokens = new Set([...localTokenSet, ...ydaemonTokenSet]);
    
    const chainResults = {
      totalTokens: allTokens.size,
      comparisons: 0,
      discrepancies: [],
      missingInLocal: 0,
      missingInYdaemon: 0
    };

    let discrepanciesFound = 0;
    
    // Create maps with lowercase keys for case-insensitive comparison
    const localTokensLower = {};
    const ydaemonTokensLower = {};
    
    for (const [token, price] of Object.entries(localTokens)) {
      localTokensLower[token.toLowerCase()] = { address: token, price };
    }
    
    for (const [token, price] of Object.entries(ydaemonTokens)) {
      ydaemonTokensLower[token.toLowerCase()] = { address: token, price };
    }
    
    for (const tokenLower of allTokens) {
      const localData = localTokensLower[tokenLower];
      const ydaemonData = ydaemonTokensLower[tokenLower];
      
      if (!localData) {
        chainResults.missingInLocal++;
        results.summary.missingInLocal++;
        continue;
      }
      
      if (!ydaemonData) {
        chainResults.missingInYdaemon++;
        results.summary.missingInYdaemon++;
        continue;
      }
      
      const localPrice = localData.price;
      const ydaemonPrice = ydaemonData.price;
      
      // Convert prices to numbers for comparison
      const numLocalPrice = typeof localPrice === 'string' ? parseFloat(localPrice) : localPrice;
      const numYdaemonPrice = typeof ydaemonPrice === 'string' ? parseFloat(ydaemonPrice) : ydaemonPrice;
      
      // Skip if prices are invalid
      if (isNaN(numLocalPrice) || isNaN(numYdaemonPrice)) {
        continue;
      }
      
      // Both prices exist, compare them
      const percentDiff = calculatePercentageDiff(numLocalPrice, numYdaemonPrice);
      chainResults.comparisons++;
      results.summary.totalComparisons++;
      
      // Use the original address from local or ydaemon for display
      const displayToken = localData.address || ydaemonData.address;
      
      // Flag large discrepancies (>5% difference)
      if (Math.abs(percentDiff) > 5) {
        discrepanciesFound++;
        results.summary.largeDiscrepancies++;
        
        const discrepancy = {
          chainId,
          chainName,
          token: displayToken,
          localPrice: numLocalPrice,
          ydaemonPrice: numYdaemonPrice,
          percentDiff,
          absoluteDiff: numLocalPrice - numYdaemonPrice
        };
        
        chainResults.discrepancies.push(discrepancy);
        results.discrepancies.push(discrepancy);
        
        // Show first 3 discrepancies for each chain
        if (discrepanciesFound <= 3) {
          console.log(`  ⚠️  ${displayToken}`);
          console.log(`     Local: $${formatPrice(numLocalPrice)} | Ydaemon: $${formatPrice(numYdaemonPrice)}`);
          console.log(`     Difference: ${percentDiff > 0 ? '+' : ''}${percentDiff.toFixed(2)}%`);
        }
      }
    }
    
    results.chains[chainId] = chainResults;
    
    // Summary for this chain
    console.log(`\n  Summary: ${chainResults.comparisons} tokens compared`);
    if (chainResults.missingInLocal > 0) {
      console.log(`  Missing in local: ${chainResults.missingInLocal}`);
    }
    if (chainResults.missingInYdaemon > 0) {
      console.log(`  Missing in ydaemon: ${chainResults.missingInYdaemon}`);
    }
    if (discrepanciesFound > 0) {
      console.log(`  Large discrepancies (>5%): ${discrepanciesFound}`);
      if (discrepanciesFound > 3) {
        console.log(`  ... and ${discrepanciesFound - 3} more discrepancies`);
      }
    }
  }

  // Sort discrepancies by percentage difference
  results.discrepancies.sort((a, b) => Math.abs(b.percentDiff) - Math.abs(a.percentDiff));

  // Overall summary
  console.log('\n=====================================');
  console.log('OVERALL SUMMARY');
  console.log('=====================================');
  console.log(`Total comparisons: ${results.summary.totalComparisons}`);
  console.log(`Large discrepancies (>5%): ${results.summary.largeDiscrepancies}`);
  console.log(`Missing in local: ${results.summary.missingInLocal}`);
  console.log(`Missing in ydaemon: ${results.summary.missingInYdaemon}`);
  
  if (results.summary.largeDiscrepancies > 0) {
    console.log('\nTop 5 largest discrepancies:');
    results.discrepancies.slice(0, 5).forEach((d, i) => {
      console.log(`${i + 1}. ${d.chainName} - ${d.token}: ${d.percentDiff > 0 ? '+' : ''}${d.percentDiff.toFixed(2)}%`);
      console.log(`   Local: $${formatPrice(d.localPrice)} | Ydaemon: $${formatPrice(d.ydaemonPrice)}`);
    });
  }

  // Save detailed report
  const filename = `price-comparison-${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));
  console.log(`\n✅ Detailed report saved to ${filename}`);

  // Also save a CSV for easy analysis
  const csvFilename = `price-discrepancies-${new Date().toISOString().split('T')[0]}.csv`;
  const csv = [
    'Chain,ChainID,Token,LocalPrice,YdaemonPrice,PercentDiff,AbsoluteDiff',
    ...results.discrepancies.map(d => 
      `"${d.chainName}",${d.chainId},"${d.token}",${d.localPrice},${d.ydaemonPrice},${d.percentDiff.toFixed(2)},${d.absoluteDiff}`
    )
  ].join('\n');
  
  fs.writeFileSync(csvFilename, csv);
  console.log(`✅ CSV report saved to ${csvFilename}`);
}

main().catch(console.error);