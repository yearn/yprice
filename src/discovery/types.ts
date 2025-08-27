export interface TokenInfo {
  address: string;
  chainId: number;
  source: string;
  name?: string;
  symbol?: string;
  decimals?: number;
}

export interface PoolInfo {
  address: string;
  token0: string;
  token1: string;
  lpToken?: string;
}

export interface CurvePoolData {
  address: string;
  name: string;
  symbol: string;
  coins: string[];
  lpTokenAddress?: string;
}

export interface VeloPoolData {
  address: string;
  symbol: string;
  token0: string;
  token1: string;
  gauge_address?: string;
  stable: boolean;
}

export interface DiscoveryConfig {
  chainId: number;
  curveFactoryAddress?: string;
  curveRegistryAddress?: string;
  veloSugarAddress?: string;
  yearnRegistryAddress?: string;
  aaveV2LendingPool?: string;
  aaveV3Pool?: string;
  compoundComptroller?: string;
  gammaHypervisor?: string;
  pendleMarketFactory?: string;
  extraTokens?: string[];
  curveApiUrl?: string;
  veloApiUrl?: string;
}