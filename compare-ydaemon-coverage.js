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

function extractTokens(prices) {
  const chains = {};
  for (const [chainId, tokens] of Object.entries(prices)) {
    chains[chainId] = new Set(Object.keys(tokens).map(t => t.toLowerCase()));
  }
  return chains;
}

async function main() {
  console.log('Fetching data...\n');

  const [localPrices, ydaemonPrices] = await Promise.all([
    fetchJSON(LOCAL_API_URL).catch(() => ({})),
    fetchJSON(YDAEMON_API_URL).catch(() => ({}))
  ]);

  const local = extractTokens(localPrices);
  const ydaemon = extractTokens(ydaemonPrices);

  console.log('=====================================');
  console.log('TOKEN COVERAGE COMPARISON');
  console.log('=====================================\n');

  let totalLocal = 0, totalYdaemon = 0, totalMissing = 0;
  const report = {};

  for (const chainId of Object.keys(ydaemon).sort((a, b) => Number(a) - Number(b))) {
    const localTokens = local[chainId] || new Set();
    const ydaemonTokens = ydaemon[chainId];

    const missing = [...ydaemonTokens].filter(t => !localTokens.has(t));
    const coverage = ((ydaemonTokens.size - missing.length) / ydaemonTokens.size * 100).toFixed(1);

    console.log(`${CHAIN_NAMES[chainId] || `Chain ${chainId}`} (${chainId}):`);
    console.log(`  Local: ${localTokens.size.toLocaleString()} | Ydaemon: ${ydaemonTokens.size.toLocaleString()} | Missing: ${missing.length.toLocaleString()} | Coverage: ${coverage}%`);

    if (missing.length > 0 && missing.length <= 3) {
      missing.forEach(t => console.log(`    - ${t}`));
    } else if (missing.length > 3) {
      missing.slice(0, 2).forEach(t => console.log(`    - ${t}`));
      console.log(`    ... and ${missing.length - 2} more`);
    }
    console.log('');

    totalLocal += localTokens.size;
    totalYdaemon += ydaemonTokens.size;
    totalMissing += missing.length;

    report[chainId] = {
      local: localTokens.size,
      ydaemon: ydaemonTokens.size,
      missing: missing.length,
      missingTokens: missing
    };
  }

  console.log('=====================================');
  console.log(`TOTAL: ${totalLocal.toLocaleString()} local | ${totalYdaemon.toLocaleString()} ydaemon | ${totalMissing.toLocaleString()} missing`);
  console.log(`Coverage: ${((totalYdaemon - totalMissing) / totalYdaemon * 100).toFixed(1)}% | Extra in local: ${(totalLocal - totalYdaemon).toLocaleString()}`);

  if (process.argv.includes('--export')) {
    fs.writeFileSync('missing-tokens-report.json', JSON.stringify(report, null, 2));
    console.log('\n✅ Exported to missing-tokens-report.json');
  }
}

main().catch(console.error);