import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import * as fs from 'fs';

const client = createPublicClient({
  chain: mainnet,
  transport: http('https://eth.llamarpc.com'),
});

const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);

async function getTokenNames() {
  // Read token addresses from file
  const addresses = fs.readFileSync('/tmp/sample_eth_tokens_tail.txt', 'utf-8')
    .split('\n')
    .filter(addr => addr.trim())
    .slice(0, 100) as `0x${string}`[]; // Take first 100
  
  console.log(`Fetching names and symbols for ${addresses.length} tokens...`);
  
  // Prepare multicall for names
  const nameCalls = addresses.map(address => ({
    address,
    abi: erc20Abi,
    functionName: 'name',
  }));
  
  // Prepare multicall for symbols
  const symbolCalls = addresses.map(address => ({
    address,
    abi: erc20Abi,
    functionName: 'symbol',
  }));
  
  try {
    // Execute multicalls
    const [nameResults, symbolResults] = await Promise.all([
      client.multicall({ contracts: nameCalls }),
      client.multicall({ contracts: symbolCalls }),
    ]);
    
    const tokenInfo = addresses.map((address, i) => ({
      address,
      name: nameResults[i].status === 'success' ? (nameResults[i].result as string) : 'UNKNOWN',
      symbol: symbolResults[i].status === 'success' ? (symbolResults[i].result as string) : 'UNKNOWN',
    }));
    
    // Categorize by protocol
    const categories: Record<string, typeof tokenInfo> = {
      curve: [],
      pendle: [],
      yearn: [],
      aave: [],
      compound: [],
      balancer: [],
      convex: [],
      frax: [],
      synthetix: [],
      uniswap: [],
      sushiswap: [],
      maker: [],
      lido: [],
      rocket_pool: [],
      other_defi: [],
      regular_tokens: [],
    };
    
    for (const token of tokenInfo) {
      const name = token.name.toLowerCase();
      const symbol = token.symbol.toLowerCase();
      
      // Check for Curve tokens
      if (name.includes('curve') || symbol.includes('crv') || 
          name.includes('gauge') || symbol.includes('-f') || 
          symbol.includes('3crv') || symbol.includes('crvusd') ||
          name.includes('factory-v2') || name.includes('crypto-v2')) {
        categories.curve.push(token);
      } 
      // Check for Pendle tokens
      else if (name.includes('pendle') || symbol.startsWith('pt-') || 
               symbol.startsWith('yt-') || symbol.startsWith('sy-') ||
               name.includes('principal token') || name.includes('yield token')) {
        categories.pendle.push(token);
      } 
      // Check for Yearn tokens
      else if (name.includes('yearn') || symbol.startsWith('yv') || 
               symbol.includes('yvault') || name.includes('yvault')) {
        categories.yearn.push(token);
      } 
      // Check for Aave tokens
      else if ((symbol.startsWith('a') && name.includes('aave')) || 
               name.includes('atoken') || symbol.includes('aamm')) {
        categories.aave.push(token);
      } 
      // Check for Compound tokens
      else if (symbol.startsWith('c') && (name.includes('compound') || symbol === 'cdai' || symbol === 'cusdc')) {
        categories.compound.push(token);
      } 
      // Check for Balancer tokens
      else if (name.includes('balancer') || symbol.includes('bpt') || 
               symbol.startsWith('b-') || name.includes('b-pool')) {
        categories.balancer.push(token);
      } 
      // Check for Convex tokens
      else if (name.includes('convex') || symbol.includes('cvx') || 
               name.includes('staked cvx')) {
        categories.convex.push(token);
      } 
      // Check for Frax tokens
      else if (name.includes('frax') || symbol.includes('frax') || 
               symbol.includes('fxs') || symbol.includes('frxeth')) {
        categories.frax.push(token);
      } 
      // Check for Synthetix tokens
      else if ((symbol.startsWith('s') && name.includes('synth')) || 
               name.includes('synthetix')) {
        categories.synthetix.push(token);
      } 
      // Check for Uniswap tokens
      else if (name.includes('uniswap') || symbol.includes('uni-v2') || 
               symbol.includes('uni-v3')) {
        categories.uniswap.push(token);
      } 
      // Check for SushiSwap tokens
      else if (name.includes('sushi') || symbol.includes('slp')) {
        categories.sushiswap.push(token);
      }
      // Check for Maker tokens
      else if (name.includes('maker') || symbol === 'dai' || symbol === 'mkr' || 
               name.includes('dai stablecoin')) {
        categories.maker.push(token);
      }
      // Check for Lido tokens
      else if (name.includes('lido') || symbol.includes('steth') || 
               symbol.includes('wsteth') || symbol.includes('stmatic')) {
        categories.lido.push(token);
      }
      // Check for Rocket Pool tokens
      else if (name.includes('rocket') || symbol.includes('reth') || 
               symbol.includes('rpl')) {
        categories.rocket_pool.push(token);
      }
      // Check for other DeFi tokens
      else if (name.includes('liquidity') || name.includes('pool') || 
               name.includes('vault') || symbol.includes('lp') ||
               name.includes('wrapped') || name.includes('staked')) {
        categories.other_defi.push(token);
      } 
      // Regular tokens
      else {
        categories.regular_tokens.push(token);
      }
    }
    
    // Print results
    console.log('\n=== TOKEN CATEGORIZATION ===\n');
    
    const sortedCategories = Object.entries(categories)
      .filter(([_, tokens]) => tokens.length > 0)
      .sort((a, b) => b[1].length - a[1].length);
    
    for (const [protocol, tokens] of sortedCategories) {
      console.log(`${protocol.toUpperCase()}: ${tokens.length} tokens`);
      tokens.slice(0, 5).forEach(t => {
        console.log(`  - ${t.symbol}: ${t.name}`);
      });
      if (tokens.length > 5) {
        console.log(`  ... and ${tokens.length - 5} more`);
      }
      console.log('');
    }
    
    // Save detailed results
    fs.writeFileSync('/tmp/token_analysis.json', JSON.stringify({
      total: tokenInfo.length,
      summary: sortedCategories.map(([protocol, tokens]) => ({
        protocol,
        count: tokens.length,
        percentage: ((tokens.length / tokenInfo.length) * 100).toFixed(1) + '%',
      })),
      categories,
      all_tokens: tokenInfo,
    }, null, 2));
    
    console.log('Detailed results saved to /tmp/token_analysis.json');
    
    // Print summary
    console.log('\n=== SUMMARY ===');
    console.log(`Total tokens analyzed: ${tokenInfo.length}`);
    console.log('\nTop protocols by token count:');
    sortedCategories.slice(0, 5).forEach(([protocol, tokens]) => {
      const percentage = ((tokens.length / tokenInfo.length) * 100).toFixed(1);
      console.log(`  ${protocol}: ${tokens.length} (${percentage}%)`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

getTokenNames();