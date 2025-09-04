export interface TokenInfo {
  address: string
  chainId: number
  source: string
  name?: string
  symbol?: string
  decimals?: number
  isVault?: boolean
}

export interface PoolInfo {
  address: string
  token0: string
  token1: string
  lpToken?: string
}

export interface CurvePoolData {
  address: string
  name: string
  symbol: string
  coins: Array<{
    address: string
    symbol: string
    name: string
    decimals: string
    usdPrice: number
    poolBalance: string
    isBasePoolLpToken: boolean
  }>
  lpTokenAddress?: string
  coinsAddresses?: string[]
}

export interface VeloPoolData {
  address: string
  symbol: string
  token0: string
  token1: string
  gauge_address?: string
  stable: boolean
}

export type DiscoverySource = 
  | 'yearn'
  | 'curve-api'
  | 'curve-factories'
  | 'velodrome'
  | 'tokenlist'
  | 'gamma'
  | 'pendle'
  | 'aave'
  | 'compound'
  | 'uniswap'
  | 'balancer'
  | 'generic-vaults'

export type PriceFetcher = 
  | 'defillama'
  | 'curve-factories'
  | 'gamma'
  | 'pendle'
  | 'velodrome'
  | 'curve-amm'
  | 'erc4626'
  | 'yearn-vault'

export interface DiscoveryConfig {
  chainId: number
  curveFactoryAddress?: string
  curveRegistryAddress?: string
  veloSugarAddress?: string
  yearnRegistryAddress?: string
  aaveV2LendingPool?: string
  aaveV3Pool?: string
  compoundComptroller?: string
  gammaHypervisor?: string
  pendleMarketFactory?: string
  extraTokens?: string[]
  curveApiUrl?: string
  veloApiUrl?: string
  supportedServices?: DiscoverySource[]
  supportedPriceFetchers?: PriceFetcher[]
}
