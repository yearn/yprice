# Yearn Pricing Service

A high-performance TypeScript pricing service that aggregates token prices from multiple DeFi protocols and external sources for Yearn Finance ecosystem.

## Price Discovery Process

1. **Token Discovery**: Automated discovery from multiple protocols
   - Scans protocol registries and factories
   - Identifies LP tokens, vault tokens, and derivatives
   - Maintains a comprehensive token registry

2. **Price Fetching**: Multi-source price aggregation
   - Primary: DeFiLlama API for broad coverage
   - Secondary: On-chain oracles (Lens Protocol)
   - Tertiary: Protocol-specific calculations
   - Fallback: Direct DEX pool queries

3. **Caching Strategy**:
   - In-memory cache with configurable TTL
   - Optional Redis for distributed deployments
   - Persistent file storage for recovery
   - Chain-specific cache isolation

## Configuration

### Environment Variables

See the `.env.example` file in the root directory:

```env
RPC_URI_FOR_1=
RPC_URI_FOR_10=
RPC_URI_FOR_100=
RPC_URI_FOR_137=
RPC_URI_FOR_146=
RPC_URI_FOR_250=
RPC_URI_FOR_8453=
RPC_URI_FOR_42161=
RPC_URI_FOR_747474=

# Redis Configuration
STORAGE_TYPE=redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
REDIS_LOAD_BACKUP=false

# Logging
LOG_LEVEL=debug
```

## Development

```bash
bun run refresh           # Run token discovery and price refresh for all chains
bun run refresh <chainId> # Run token discovery and price refresh for a specific chain
bun vercel                # Run local Vercel development server

bun run lint              # Check code style
bun run lint:fix          # Fix code style issues
bun run format            # Format code with Biome
```

### Refreshing Prices

You can refresh prices for all chains or a specific chain:

```bash
# Refresh all chains
bun run refresh

# Refresh only Ethereum (chain 1)
bun run refresh 1

# Refresh only Optimism (chain 10)
bun run refresh 10
```

This is useful for testing and debugging specific chain configurations without waiting for all chains to complete.

### Vercel Deployment

```bash
# Deploy to Vercel
bun run deploy
```

## API Endpoints

All endpoints maintain compatibility with the original Go implementation:

### Get All Prices

```
GET /prices/all
```

Returns prices for all tokens across all supported chains.

Query Parameters:

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

## API Response Format

### Standard Price Response

```json
{
  "0x...": 1234.56,
  "0x...": 0.9876
}
```

### Detailed Price Response (`/details` endpoints)

```json
{
  "0x...": {
    "price": 1234.56,
    "source": "defillama",
    "timestamp": 1699123456,
    "confidence": 0.99
  }
}
```

## License

MIT License - see [LICENSE](LICENSE) file for details
