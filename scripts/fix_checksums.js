const { getAddress } = require('viem');

// Fix checksums for all addresses in config
const addresses = [
  // Gnosis factories
  '0x0Ba26E3E1ebcE10032f8e5D9cF13d505F0d36187',
  '0xbC0797015fcFc47d9C1856639CaE50D0e69FbEE8',
  '0x3d6cb2f6dcF47cDD9C13E4E3beAe9af041d8796a',
  
  // Polygon
  '0x32bF3dc86E278F17d6449F88a9d30385106319Dc',
  
  // Fantom
  '0x727fE1759430df13655ddb0731dE0D0FDE929b04',
];

console.log('Fixed checksummed addresses:\n');
addresses.forEach(addr => {
  try {
    const fixed = getAddress(addr);
    console.log(`'${addr}' -> '${fixed}'`);
  } catch (e) {
    console.log(`Invalid: ${addr}`);
  }
});