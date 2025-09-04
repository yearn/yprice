import { DiscoveryConfig } from 'discovery/types'

export const DISCOVERY_CONFIGS: Record<number, DiscoveryConfig> = {
  // Ethereum Mainnet
  1: {
    chainId: 1,
    curveFactoryAddress: '0xB9fC157394Af804a3578134A6585C0dc9cc990d4',
    curveRegistryAddress: '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5',
    curveApiUrl: 'https://api.curve.finance/api/getPools/all/ethereum',
    yearnRegistryAddress: '0x50c1a2eA0a861A967D9d0FFE2AE4012c2E053804',
    aaveV2LendingPool: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
    aaveV3Pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    compoundComptroller: '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B',
    supportedServices: [
      'yearn',
      'curve-api',
      'curve-factories',
      'tokenlist',
      'pendle',
      'aave',
      'compound',
      'uniswap',
      'balancer',
      'generic-vaults'
    ],
    supportedPriceFetchers: [
      'defillama',
      'curve-factories',
      'pendle',
      'curve-amm',
      'erc4626',
      'yearn-vault'
    ],
    extraTokens: [
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
      '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
      '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', // YFI
      '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
      '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', // AAVE
      '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
      '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F', // SNX
    ],
  },
  // Optimism
  10: {
    chainId: 10,
    veloSugarAddress: '0xb8A82F0334E43C2Eb0AB5d799036965F7bf07Ba8', // LP Sugar v3
    yearnRegistryAddress: '0x79286Dd38C9017E5423073bAc11F53357Fc5C128',
    aaveV3Pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    supportedServices: [
      'yearn',
      // 'velodrome', // Temporarily disabled due to Sugar contract issues
      'tokenlist',
      'aave',
      'uniswap',
      'curve-factories',
      'balancer',
      'generic-vaults'
    ],
    supportedPriceFetchers: [
      'defillama',
      'curve-factories',
      'velodrome',
      'gamma',
      'erc4626',
      'yearn-vault'
    ],
    extraTokens: [
      '0x4200000000000000000000000000000000000006', // WETH
      '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', // USDC.e
      '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC
      '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', // USDT
      '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
      '0x4200000000000000000000000000000000000042', // OP
    ],
  },
  // Gnosis
  100: {
    chainId: 100,
    aaveV3Pool: '0xb50201558B00496A145fE76f7424749556E326D8',
    supportedServices: [
      'yearn',
      'tokenlist',
      'aave',
      'curve-factories',
      'balancer',
      'generic-vaults'
    ],
    supportedPriceFetchers: [
      'defillama',
      'curve-factories',
      'gamma',
      'erc4626',
      'yearn-vault'
    ],
    extraTokens: [
      '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d', // WXDAI
      '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1', // WETH
      '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83', // USDC
      '0x4ECaBa5870353805a9F068101A40E0f32ed605C6', // USDT
    ],
  },
  // Polygon
  137: {
    chainId: 137,
    curveApiUrl: 'https://api.curve.finance/api/getPools/all/polygon',
    yearnRegistryAddress: '0x32bF3dc86E278F17D6449f88A9d30385106319Dc',
    aaveV2LendingPool: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
    aaveV3Pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    supportedServices: [
      'yearn',
      'curve-api',
      'curve-factories',
      'tokenlist',
      'aave',
      'uniswap',
      'balancer',
      'generic-vaults'
    ],
    supportedPriceFetchers: [
      'defillama',
      'curve-factories',
      'curve-amm',
      'erc4626',
      'yearn-vault'
    ],
    extraTokens: [
      '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
      '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH
      '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC.e
      '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC
      '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
      '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', // DAI
      '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', // WBTC
    ],
  },
  // Fantom
  250: {
    chainId: 250,
    curveApiUrl: 'https://api.curve.finance/api/getPools/all/fantom',
    yearnRegistryAddress: '0x727fe1759430df13655ddb0731dE0D0FDE929b04',
    supportedServices: [
      'yearn',
      'curve-api',
      'curve-factories',
      'tokenlist',
      'uniswap',
      'balancer',
      'generic-vaults'
    ],
    supportedPriceFetchers: [
      'defillama',
      'curve-factories',
      'gamma',
      'curve-amm',
      'erc4626',
      'yearn-vault'
    ],
    extraTokens: [
      '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83', // WFTM
      '0x74b23882a30290451A17c44f4F05243b6b58C76d', // WETH
      '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75', // USDC
      '0x049d68029688eAbF473097a2fC38ef61633A3C7A', // fUSDT
      '0x8D11eC38a3EB5E956B052f67Da8Bdc9bef8Abf3E', // DAI
    ],
  },
  // Base
  8453: {
    chainId: 8453,
    veloSugarAddress: '0x68c19e13618C41158fE4bAba1B8fb3A9c74bDb0A', // LP Sugar v3
    aaveV3Pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    supportedServices: [
      'yearn',
      // 'velodrome', // Temporarily disabled due to Sugar contract issues
      'tokenlist',
      'aave',
      'uniswap',
      'curve-factories',
      'balancer',
      'generic-vaults'
    ],
    supportedPriceFetchers: [
      'defillama',
      'curve-factories',
      'velodrome',
      'erc4626',
      'yearn-vault'
    ],
    extraTokens: [
      '0x4200000000000000000000000000000000000006', // WETH
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
      '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', // USDbC
      '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', // DAI
    ],
  },
  // Arbitrum
  42161: {
    chainId: 42161,
    curveApiUrl: 'https://api.curve.finance/api/getPools/all/arbitrum',
    curveFactoryAddress: '0x0c0e5f2fF0ff18a3be9b835635039256dC4B4963',
    yearnRegistryAddress: '0x3199437193625DCcD6F9C9e98BDf93582200Eb1f',
    aaveV3Pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    supportedServices: [
      'yearn',
      'curve-api',
      'curve-factories',
      'tokenlist',
      'pendle',
      'aave',
      'uniswap',
      'balancer',
      'generic-vaults'
    ],
    supportedPriceFetchers: [
      'defillama',
      'curve-factories',
      'pendle',
      'curve-amm',
      'erc4626',
      'yearn-vault'
    ],
    extraTokens: [
      '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
      '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC.e
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
      '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
      '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
      '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', // WBTC
      '0x912CE59144191C1204E64559FE8253a0e49E6548', // ARB
    ],
  },
  // BSC
  56: {
    chainId: 56,
    supportedServices: [
      'tokenlist',
      'pendle'
    ],
    supportedPriceFetchers: [
      'defillama',
      'pendle'
    ],
    extraTokens: [
      '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
      '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
      '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
      '0x55d398326f99059fF775485246999027B3197955', // USDT
      '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', // DAI
      '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', // ETH
    ],
  },
  // Avalanche C-Chain
  43114: {
    chainId: 43114,
    supportedServices: [
      'tokenlist'
    ],
    supportedPriceFetchers: [
      'defillama'
    ],
    extraTokens: [
      '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
      '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // USDC
      '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', // USDT
      '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70', // DAI
      '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', // WETH.e
      '0x50b7545627a5162F82A992c33b87aDc75187B218', // WBTC.e
    ],
  },
  // Sonic (formerly Fantom Sonic)
  146: {
    chainId: 146,
    supportedServices: [
      'yearn'
    ],
    supportedPriceFetchers: [
      'yearn-vault'
    ],
    extraTokens: [
      // Add native and common tokens when available
    ],
  },
  // Katana
  747474: {
    chainId: 747474,
    supportedServices: [
      'yearn'
    ],
    supportedPriceFetchers: [
      'defillama',
      'yearn-vault'
    ],
    extraTokens: [
      // Add native and common tokens when available
    ],
  },
}
