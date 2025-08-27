# Yearn Pricing Service

TypeScript implementation of the Yearn Finance pricing service that fetches and serves token prices from multiple sources.

## Features

- Multi-source price fetching (DeFiLlama, CoinGecko, and more)
- In-memory caching with TTL and persistence
- REST API with the same endpoints as the original Go implementation
- Support for multiple blockchain networks
- Rate limiting and error handling
- Fully typed with TypeScript

## Installation

```bash
npm install
# or
yarn install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

### Environment Variables

- `PORT` - Server port (default: 8080)
- `NODE_ENV` - Environment (development/production)
- `COINGECKO_API_KEY` - Optional CoinGecko API key for better rate limits
- `DEFILLAMA_API_KEY` - Optional DeFiLlama API key
- `CACHE_TTL_SECONDS` - Cache TTL in seconds (default: 60)
- `RATE_LIMIT_WINDOW_MS` - Rate limit window in milliseconds
- `RATE_LIMIT_MAX_REQUESTS` - Max requests per window
- `LOG_LEVEL` - Logging level (info/debug/error)

## Development

```bash
npm run dev
```

## Production

```bash
npm run build
npm start
```

## API Endpoints

All endpoints maintain compatibility with the original Go implementation:

### Get All Prices

```
GET /prices/all
```

Returns prices for all tokens across all supported chains.

Query Parameters:
- `humanized` (optional): Return human-readable prices instead of raw bigints

### Get Chain Prices

```
GET /prices/:chainID
```

Returns all prices for a specific chain.

### Get Chain Prices (Detailed)

```
GET /prices/:chainID/all
GET /prices/:chainID/all/details
```

Returns detailed price information for all tokens on a chain.

### Get Single Price

```
GET /prices/:chainID/:address
```

Returns the price for a single token.

### Get Multiple Prices

```
GET /prices/:chainID/some/:addresses
```

Returns prices for multiple tokens on a specific chain.
Addresses should be comma-separated.

### Get Cross-Chain Prices

```
GET /prices/some/:addresses
```

Returns prices for tokens across all chains.

### Batch Price Request

```
POST /prices/some
```

Request body:
```json
{
  "addresses": ["0x...", "0x..."],
  "chainIds": [1, 137] // optional, defaults to all chains
}
```

## Supported Chains

- Ethereum (1)
- Optimism (10)
- Gnosis/xDai (100)
- Polygon (137)
- Fantom (250)
- Base (8453)
- Arbitrum (42161)
- Katana (747474)

## Architecture

```
src/
├── models/          # TypeScript interfaces and types
├── storage/         # In-memory cache with persistence
├── fetchers/        # Price fetching from external sources
│   ├── defillama.ts
│   ├── coingecko.ts
│   └── index.ts     # Orchestrator
├── api/            # Express routes
├── utils/          # Helper functions
└── index.ts        # Main application entry
```

## Testing

```bash
npm test
```

## Price Sources

The service fetches prices from multiple sources in order of priority:

1. **DeFiLlama** - Primary source with wide token coverage
2. **CoinGecko** - Fallback for tokens not found in DeFiLlama
3. Additional sources can be added by implementing the fetcher interface

## Caching Strategy

- In-memory cache with configurable TTL (default: 60 seconds)
- Automatic persistence to disk for recovery after restarts
- Chain-specific cache isolation
- Concurrent-safe operations

## API Response Format

### Raw Price Response (default)
```json
{
  "address": "0x...",
  "price": "1000000",
  "source": "defillama"
}
```

### Humanized Price Response (with ?humanized=true)
```json
{
  "address": "0x...",
  "humanizedPrice": 1.0,
  "source": "defillama"
}
```

## License

MIT