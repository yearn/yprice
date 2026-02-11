# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Yearn Pricing Service (`@yearn/pricing`) — a TypeScript service that discovers tokens from DeFi protocols and aggregates their prices from multiple on-chain and off-chain sources. Deployed as Vercel serverless functions with Redis (Upstash) storage in production.

## Development Commands

```bash
bun install                                    # Install dependencies
bun run refresh                                # Discover tokens + fetch prices for all chains
bun run refresh <chainId>                      # Discover + fetch for a specific chain (e.g. bun run refresh 1)
bun run refresh-route <chainId> <route>        # Run a specific discovery service or fetcher (e.g. bun run refresh-route 1 defillama)
bun run refresh-route <chainId> <route> --csv  # Same but export results to CSV
bun vercel                                     # Run local Vercel dev server (serves API endpoints)
bun run build                                  # TypeScript compile (tsc && tsc-alias)
bun run lint                                   # Biome check
bun run lint:fix                               # Biome check --write
bun run format                                 # Biome format --write
bun run analyze                                # Compare prices against yDaemon reference
bun run test                                   # Jest (no tests currently exist)
```

## Architecture

### Two-Phase Pipeline

The service runs a two-phase pipeline per chain:

1. **Discovery** (`src/discovery/`) — finds token addresses from protocol registries, APIs, and on-chain factories. Each discovery service implements the `Discovery` interface (`discoverTokens(): Promise<TokenInfo[]>`). Configured per-chain in `src/discovery/config.ts` via `supportedServices`.

2. **Fetching** (`src/fetchers/`) — prices discovered tokens. `PriceFetcherOrchestrator` runs independent fetchers (DeFiLlama, Curve, Gamma, Pendle, Velodrome) in parallel, then dependent fetchers (CurveAmm, ERC4626, YearnVault) that need existing prices for LP/vault calculations. Configured per-chain via `supportedPriceFetchers`.

Within `PriceService.fetchDiscoveredTokens()`, tokens are split into base tokens and derivatives. Base tokens are priced first, then derivatives receive accumulated base prices for their calculations.

### Key Modules

- **`src/discovery/config.ts`** — `DISCOVERY_CONFIGS` record: per-chain configuration of contract addresses, supported discovery services, supported price fetchers, base tokens, and `skipAddresses`. This is the central configuration file.
- **`src/discovery/registry.ts`** — `DISCOVERY_REGISTRY` array: data-driven registry of all discovery services with factory functions, display names, and per-source timeouts. Adding a new discovery service means adding an entry here.
- **`src/discovery/tokenDiscoveryService.ts`** — `TokenDiscoveryService`: iterates `DISCOVERY_REGISTRY` to run matching discovery services in parallel per chain.
- **`src/services/priceService.ts`** — orchestrates the full pipeline: discovery → batched price fetching → storage. Singleton export.
- **`src/fetchers/index.ts`** — `PriceFetcherOrchestrator`: manages fetcher execution order (independent vs dependent). Uses `mergeFetcherResults` helper to deduplicate result-processing.
- **`src/storage/`** — `StorageInterface` (all-async) with two implementations: `PriceStorage` (file-based with NodeCache) and `RedisStorage` (Upstash Redis). Selected via `STORAGE_TYPE` env var.
- **`src/utils/http.ts`** — `fetchJson<T>()` shared HTTP utility with exponential backoff retry (429, 5xx, timeout). All API calls across discovery and fetcher services use this.
- **`src/utils/priceCache.ts`** — `PriceCache`: unified in-memory cache for both hot prices (token-type-aware TTLs) and discovery metadata (`setDiscovered`/`getDiscovered` for vault versions, pricePerShare, underlying addresses, etc.).
- **`src/utils/viemClients.ts`** — viem `PublicClient` factory with multicall batching. Supports context-based isolated clients for parallel execution.
- **`src/utils/multicallAggregator.ts`** — singleton that batches on-chain reads into efficient multicalls with retry logic and rate limiting.
- **`src/models/types.ts`** — core types: `Price` (address, price as bigint, source), `ERC20Token`, `PriceSource` enum.

### API Layer (Vercel Serverless)

- `api/index.ts` — service info
- `api/prices.ts` — all prices across all chains
- `api/prices/chain/[chainId].ts` — prices for a specific chain
- `api/prices/tokens/[list].ts` — specific tokens (format: `chainId:address,chainId:address`)
- `api/healthcheck.ts` — health status
- `api/_lib/storage.ts` — shared storage initialization for all API routes

Routes are rewritten in `vercel.json`. The API reads from Redis storage only (no discovery/fetching at request time).

### Entry Points

- `src/refresh.ts` — CLI entry for full discovery + price refresh (used by `bun run refresh`)
- `src/refresh-route.ts` — CLI entry for single discovery service or fetcher (used by `bun run refresh-route`)
- `src/bootstrap.ts` — shared CLI bootstrap (dotenv, storage init, signal handlers) used by both entry points

## Supported Chains

Ethereum (1), Optimism (10), Gnosis (100), Polygon (137), Fantom (250), Base (8453), Arbitrum (42161), Katana (747474). Chain IDs map to RPC URLs via `RPC_URI_FOR_<chainId>` env vars.

## Environment

Requires `.env` with `RPC_URI_FOR_<chainId>` for each chain. Redis requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Set `STORAGE_TYPE=redis` for Redis, defaults to `file` (writes to `data/prices/`).

## Code Style

- Biome for linting and formatting (single quotes, no semicolons, 2-space indent, 100 char line width)
- TypeScript strict mode with `noUncheckedIndexedAccess`
- Path aliases: `models/*`, `discovery/*`, `fetchers/*`, `services/*`, `storage/*`, `utils/*`, `bootstrap` (baseUrl: `./src`)
- Prices stored as `bigint` (6 decimal precision for USD)
- All on-chain reads should go through `batchReadContracts` from `src/utils/multicallAggregator.ts`
- All HTTP requests should use `fetchJson` from `src/utils/http.ts` (not raw axios)

## Adding a New Chain

1. Add chain definition to `src/utils/viemClients.ts` (or use existing viem chain)
2. Add `SUPPORTED_CHAINS` entry in `src/models/types.ts`
3. Add `DISCOVERY_CONFIGS` entry in `src/discovery/config.ts` with supported services, fetchers, and base tokens
4. Add `RPC_URI_FOR_<chainId>` to environment

## Adding a New Discovery Service

1. Implement the `Discovery` interface from `src/discovery/types.ts`
2. Add an entry to `DISCOVERY_REGISTRY` in `src/discovery/registry.ts` with source name, display name, timeout, and factory function
3. Add the source to relevant chains' `supportedServices` in `src/discovery/config.ts`

## Adding a New Price Fetcher

1. Follow the pattern in existing fetchers (accept chainId, tokens, optional existing prices; return `Map<string, Price>`)
2. Register in `PriceFetcherOrchestrator` in `src/fetchers/index.ts` — add to independent or dependent fetchers as appropriate
3. Add to relevant chains' `supportedPriceFetchers` in `src/discovery/config.ts`
