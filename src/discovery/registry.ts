import { AAVEDiscovery } from 'discovery/services/aaveDiscovery'
import { BalancerDiscovery } from 'discovery/services/balancerDiscovery'
import { CompoundDiscovery } from 'discovery/services/compoundDiscovery'
import {
  CurveDiscovery,
  CurveFactoriesDiscovery,
  CurveRegistriesDiscovery,
} from 'discovery/services/curveDiscovery'
import { GammaDiscovery } from 'discovery/services/gammaDiscovery'
import { GenericVaultDiscovery } from 'discovery/services/genericVaultDiscovery'
import { PendleDiscovery } from 'discovery/services/pendleDiscovery'
import tokenListDiscovery from 'discovery/services/tokenListDiscovery'
import { UniswapDiscovery } from 'discovery/services/uniswapDiscovery'
import { VeloDiscovery } from 'discovery/services/veloDiscovery'
import { YearnDiscovery } from 'discovery/services/yearnDiscovery'
import type { Discovery, DiscoveryConfig, DiscoverySource, TokenInfo } from 'discovery/types'
import type { ERC20Token } from 'models/index'

interface DiscoveryRegistryEntry {
  source: DiscoverySource
  displayName: string
  timeoutMs: number
  create: (
    chainId: number,
    config: DiscoveryConfig,
    rpcUrl?: string,
  ) => Discovery | WrappedDiscovery | null
}

// Wrapper for tokenListDiscovery which doesn't conform to Discovery interface
interface WrappedDiscovery {
  discoverTokens(): Promise<TokenInfo[]>
}

export const DISCOVERY_REGISTRY: DiscoveryRegistryEntry[] = [
  {
    source: 'yearn',
    displayName: 'Yearn',
    timeoutMs: 60000,
    create: (_chainId, _config, rpcUrl) => (rpcUrl ? new YearnDiscovery(_chainId, rpcUrl) : null),
  },
  {
    source: 'curve-api',
    displayName: 'Curve API',
    timeoutMs: 45000,
    create: (chainId, config, rpcUrl) =>
      config.curveFactoryAddress || config.curveApiUrl
        ? new CurveDiscovery(chainId, config.curveFactoryAddress, config.curveApiUrl, rpcUrl)
        : null,
  },
  {
    source: 'curve-factories',
    displayName: 'Curve Factories',
    timeoutMs: 60000,
    create: (chainId, _config, rpcUrl) =>
      rpcUrl ? new CurveFactoriesDiscovery(chainId, rpcUrl) : null,
  },
  {
    source: 'curve-registries',
    displayName: 'Curve Registries',
    timeoutMs: 90000,
    create: (chainId, _config, rpcUrl) =>
      rpcUrl ? new CurveRegistriesDiscovery(chainId, rpcUrl) : null,
  },
  {
    source: 'velodrome',
    displayName: 'Velodrome/Aerodrome',
    timeoutMs: 90000,
    create: (chainId, config, rpcUrl) =>
      config.veloSugarAddress || config.veloApiUrl
        ? new VeloDiscovery(chainId, config.veloSugarAddress, config.veloApiUrl, rpcUrl)
        : null,
  },
  {
    source: 'tokenlist',
    displayName: 'Token Lists',
    timeoutMs: 45000,
    create: (chainId) => ({
      discoverTokens: () =>
        tokenListDiscovery.discoverTokens(chainId).then((tokens: ERC20Token[]) =>
          tokens.map((t) => ({
            address: t.address,
            chainId: t.chainId,
            source: 'tokenlist' as const,
          })),
        ),
    }),
  },
  {
    source: 'gamma',
    displayName: 'Gamma',
    timeoutMs: 45000,
    create: (chainId) => new GammaDiscovery(chainId),
  },
  {
    source: 'pendle',
    displayName: 'Pendle',
    timeoutMs: 45000,
    create: (chainId) => new PendleDiscovery(chainId),
  },
  {
    source: 'aave',
    displayName: 'AAVE',
    timeoutMs: 60000,
    create: (chainId, config, rpcUrl) =>
      (config.aaveV2LendingPool || config.aaveV3Pool) && rpcUrl
        ? new AAVEDiscovery(chainId, config.aaveV2LendingPool, config.aaveV3Pool, rpcUrl)
        : null,
  },
  {
    source: 'compound',
    displayName: 'Compound',
    timeoutMs: 60000,
    create: (chainId, config, rpcUrl) =>
      config.compoundComptroller && rpcUrl
        ? new CompoundDiscovery(chainId, config.compoundComptroller, rpcUrl)
        : null,
  },
  {
    source: 'uniswap',
    displayName: 'Uniswap',
    timeoutMs: 60000,
    create: (chainId, _config, rpcUrl) => (rpcUrl ? new UniswapDiscovery(chainId) : null),
  },
  {
    source: 'balancer',
    displayName: 'Balancer',
    timeoutMs: 45000,
    create: (chainId) => new BalancerDiscovery(chainId),
  },
  {
    source: 'generic-vaults',
    displayName: 'Generic Vaults',
    timeoutMs: 45000,
    create: (chainId) => new GenericVaultDiscovery(chainId),
  },
]
