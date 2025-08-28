const fs = require('fs');

const ydaemon = JSON.parse(fs.readFileSync('ydaemon_prices.json', 'utf8'));
const ours = JSON.parse(fs.readFileSync('our_prices.json', 'utf8'));

const ydaemonKeys = Object.keys(ydaemon);
const ourKeys = Object.keys(ours);

const missingInOurs = ydaemonKeys.filter(key => !ourKeys.includes(key));
const extraInOurs = ourKeys.filter(key => !ydaemonKeys.includes(key));

console.log('=== Missing Token Analysis ===\n');
console.log(`Ydaemon total: ${ydaemonKeys.length}`);
console.log(`Our service total: ${ourKeys.length}`);
console.log(`\nTokens in ydaemon but NOT in our service: ${missingInOurs.length}`);
console.log(`Tokens in our service but NOT in ydaemon: ${extraInOurs.length}`);

if (missingInOurs.length > 0) {
  console.log('\n=== First 20 tokens missing from our service ===');
  missingInOurs.slice(0, 20).forEach((addr, i) => {
    const price = ydaemon[addr];
    console.log(`${i+1}. ${addr}: ${price}`);
  });
  
  // Save full list to file
  fs.writeFileSync('missing_tokens.txt', missingInOurs.join('\n'));
  console.log(`\nFull list saved to missing_tokens.txt (${missingInOurs.length} tokens)`);
}

if (extraInOurs.length > 0) {
  console.log('\n=== First 20 extra tokens we have ===');
  extraInOurs.slice(0, 20).forEach((addr, i) => {
    const price = ours[addr];
    console.log(`${i+1}. ${addr}: ${price}`);
  });
}
