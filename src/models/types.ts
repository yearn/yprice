export interface ChainConfig {
  id: number;
  name: string;
  rpcUrl?: string;
}

export const SUPPORTED_CHAINS: Record<string, ChainConfig> = {
  ETHEREUM: { id: 1, name: 'ethereum' },
  OPTIMISM: { id: 10, name: 'optimism' },
  GNOSIS: { id: 100, name: 'xdai' },
  POLYGON: { id: 137, name: 'polygon' },
  FANTOM: { id: 250, name: 'fantom' },
  BASE: { id: 8453, name: 'base' },
  ARBITRUM: { id: 42161, name: 'arbitrum' },
  KATANA: { id: 747474, name: 'katana' },
};

export const WETH_ADDRESSES: Record<number, string> = {
  1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  10: '0x4200000000000000000000000000000000000006',
  42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
  8453: '0x4200000000000000000000000000000000000006',
};

export interface Price {
  address: string;
  price: bigint;
  humanizedPrice?: number;
  source: string;
}

export interface ERC20Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  source?: string;
}

export interface CurveFactoriesPoolData {
  name: string;
  symbol: string;
  address: string;
  lpTokenAddress: string;
  totalSupply: string;
  usdTotal: number;
  coins: Array<{
    address: string;
    decimals: any;
    symbol: string;
    usdPrice: any;
  }>;
}

export interface CurveFactories {
  data: {
    poolData: CurveFactoriesPoolData[];
  };
}

export interface LlamaPriceData {
  decimals: number;
  price: number;
  symbol: string;
}

export interface LlamaPrice {
  coins: Record<string, LlamaPriceData>;
}

export interface GeckoPrice {
  [key: string]: {
    usd: number;
  };
}

export interface GeckoAPIKeyStatus {
  status: {
    error_code: number;
    error_message: string;
  };
}

export interface VeloToken {
  price: number;
  nativeChainAddress: string;
  nativeChainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI: string;
}

export interface VeloPairData {
  tvl: number;
  apr: number;
  address: string;
  symbol: string;
  decimals: number;
  stable: boolean;
  reserve0: number;
  reserve1: number;
  token0_address: string;
  token1_address: string;
  gauge_address: string;
  isStable: boolean;
  totalSupply: number;
  token0: VeloToken;
  token1: VeloToken;
  gauge: {
    bribes: Array<{
      token: VeloToken;
    }>;
  };
}

export interface VeloPairs {
  data: VeloPairData[];
}

export interface PriceResponse {
  address: string;
  price: string;
  humanizedPrice?: number;
  source: string;
}

export interface PriceMapResponse {
  [address: string]: PriceResponse;
}

export interface ChainPricesResponse {
  [chainId: string]: PriceMapResponse;
}

export enum PriceSource {
  DEFILLAMA = 'defillama',
  CURVE_FACTORIES = 'curve-factories',
  VELO = 'velodrome',
  AERO = 'aerodrome',
  CURVE_AMM = 'curve-amm',
  GAMMA = 'gamma',
  PENDLE = 'pendle',
  LENS = 'lens',
  ERC4626 = 'erc4626',
  VAULT_V2 = 'vault-v2',
  CACHED = 'cached',
  UNKNOWN = 'unknown',
}