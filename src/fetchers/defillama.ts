import axios from 'axios'
import { find, forEach, partition, reduce } from 'lodash'
import { ERC20Token, LlamaPrice, Price, PriceSource } from 'models/index'
import pLimit from 'p-limit'
import { addressEquals, chunk, logger, parseUnits } from 'utils/index'
import { priceCache } from 'utils/priceCache'
import { zeroAddress } from 'viem'

const LLAMA_CHAIN_NAMES: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  100: 'xdai',
  137: 'polygon',
  250: 'fantom',
  8453: 'base',
  42161: 'arbitrum',
  747474: 'katana',
}

const AJNA_TOKENS: Record<number, string> = {
  1: '0x9a96ec9B57Fb64FbC60B423d1f4da7691Bd35079',
  10: '0x6c518f9D1a163379235816c543E62922a79863Fa',
  100: '0x67Ee2155601e168F7777F169Cd74f3E22BB5E0cE',
  137: '0xA63b19647787Da652D0826424460D1BBf43Bf9c6',
  8453: '0xf0f326af3b1Ed943ab95C29470730CC8Cf66ae47',
  42161: '0xA98c94d67D9dF259Bee2E7b519dF75aB00E3E2A8',
}

const KATANA_TOKEN_TO_MAINNET: Record<string, { name: string; address: string }> = {
  'Vault Bridge WBTC': {
    name: 'Wrapped BTC',
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  'Vault Bridge USDC': { name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  'Vault Bridge USDT': {
    name: 'Tether USD',
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  'Vault Bridge USDS': {
    name: 'USDS Stablecoin',
    address: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
  },
  'Vault Bridge ETH': {
    name: 'Wrapped Ether',
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  AUSD: { name: 'AUSD', address: '0x00000000efe302beaa2b3e6e1b18d08d69a9012a' },
}

interface DefiLlamaFetcher {
  fetchPrices(chainId: number, tokens: ERC20Token[]): Promise<Map<string, Price>>
}

export class DefilllamaFetcher implements DefiLlamaFetcher {
  private readonly baseUrl = 'https://coins.llama.fi'
  private readonly limit = pLimit(10)
  private readonly BATCH_SIZE = 100 // Reduced from 200 to avoid 413 errors

  async fetchPrices(chainId: number, tokens: ERC20Token[]): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>()
    const chainName = LLAMA_CHAIN_NAMES[chainId]

    if (!chainName) {
      logger.warn(`Chain ${chainId} not supported by DeFiLlama`)
      return prices
    }

    if (chainId === 747474) {
      return this.fetchKatanaPrices(tokens)
    }

    const cachedPrices = priceCache.getMany(
      chainId,
      tokens.map((t) => t.address),
    )
    forEach(Array.from(cachedPrices.entries()), ([address, price]) => {
      prices.set(address, price)
    })

    const [, uncachedTokens] = partition(tokens, (t) => prices.has(t.address.toLowerCase()))

    if (uncachedTokens.length === 0) {
      logger.debug(`DeFiLlama: All ${tokens.length} prices from cache`)
      return prices
    }

    logger.debug(
      `DeFiLlama: ${cachedPrices.size} from cache, fetching ${uncachedTokens.length} tokens`,
    )

    const tokenChunks = chunk(uncachedTokens, this.BATCH_SIZE)
    const results = await Promise.all(
      tokenChunks.map((chunk) =>
        this.limit(() => this.fetchChunkPrices(chainName, chainId, chunk)),
      ),
    )

    const symbolMap = reduce(
      tokens,
      (acc, t) => {
        acc.set(t.address.toLowerCase(), t.symbol)
        return acc
      },
      new Map<string, string>(),
    )

    forEach(results, (chunkPrices) => {
      forEach(Array.from(chunkPrices.entries()), ([address, price]) => {
        prices.set(address, price)
        priceCache.set(chainId, address, price, symbolMap.get(address))
      })
    })

    this.handleAjnaTokens(chainId, tokens, prices)

    return prices
  }

  private async fetchChunkPrices(
    chainName: string,
    chainId: number,
    tokens: ERC20Token[],
  ): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>()

    try {
      const addresses = tokens.map((t) => `${chainName}:${t.address}`).join(',')
      const url = `${this.baseUrl}/prices/current/${addresses}`

      // Log URL length for debugging 413 errors
      if (url.length > 8000) {
        logger.warn(`DeFiLlama URL length ${url.length} may cause issues`)
      }

      const majorTokens = tokens.filter((t) => ['WETH', 'USDC', 'USDT', 'DAI'].includes(t.symbol))

      if (majorTokens.length > 0 && chainId === 1) {
        logger.debug(
          `Fetching prices for major tokens on Ethereum:`,
          majorTokens.map((t) => `${t.symbol}: ${t.address}`),
        )
      }

      const response = await axios.get<LlamaPrice>(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'yearn-pricing-service' },
      })

      if (response.data?.coins) {
        if (chainId === 1) {
          const receivedAddresses = Object.keys(response.data.coins).map((k) =>
            k.split(':')[1]?.toLowerCase(),
          )
          const majorMissing = majorTokens.filter(
            (t) => !receivedAddresses.includes(t.address.toLowerCase()),
          )
          if (majorMissing.length > 0) {
            logger.debug(
              `DeFiLlama missing prices for major tokens:`,
              majorMissing.map((t) => `${t.symbol}: ${t.address}`),
            )
          }
        }

        forEach(Object.entries(response.data.coins), ([key, data]) => {
          const address = key.split(':')[1]
          if (address && data.price > 0) {
            const token = find(tokens, (t) => addressEquals(t.address, address))
            if (token) {
              prices.set(token.address.toLowerCase(), {
                address: token.address,
                price: parseUnits(data.price.toString(), 6),
                source: PriceSource.DEFILLAMA,
              })
            }
          }
        })
      }
    } catch (error: any) {
      if (error.response?.status === 413) {
        logger.error(
          `DeFiLlama 413 Payload Too Large for ${tokens.length} tokens, will retry with smaller batch`,
        )
        // If we get 413, try again with half the batch size
        if (tokens.length > 10) {
          const halfChunks = chunk(tokens, Math.floor(tokens.length / 2))
          for (const halfChunk of halfChunks) {
            const halfPrices = await this.fetchChunkPrices(chainName, chainId, halfChunk)
            forEach(Array.from(halfPrices.entries()), ([address, price]) => {
              prices.set(address, price)
            })
          }
        }
      } else {
        logger.debug(`DeFiLlama fetch error for chain ${chainId}:`, error.message)
      }
    }

    logger.debug(`DeFiLlama returned ${prices.size} prices`)
    return prices
  }

  private async fetchKatanaPrices(tokens: ERC20Token[]): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>()

    const mainnetTokens = await this.getMainnetTokensForKatana(tokens)
    if (mainnetTokens.length === 0) {
      return prices
    }

    const mainnetPrices = await this.fetchChunkPrices('ethereum', 1, mainnetTokens)

    forEach(tokens, (token) => {
      const mainnetInfo = KATANA_TOKEN_TO_MAINNET[token.name]
      if (mainnetInfo) {
        const mainnetToken = find(
          mainnetTokens,
          (t) => t.address.toLowerCase() === mainnetInfo.address.toLowerCase(),
        )
        if (mainnetToken) {
          const price = mainnetPrices.get(mainnetToken.address.toLowerCase())
          if (price) {
            // Katana uses 18 decimals for all tokens, but we need to return prices in 6 decimals
            // to match ydaemon format. The price from mainnet is already in 6 decimals.
            prices.set(token.address.toLowerCase(), {
              ...price,
              address: token.address,
            })
          }
        }
      }
    })

    return prices
  }

  private async getMainnetTokensForKatana(tokens: ERC20Token[]): Promise<ERC20Token[]> {
    return reduce(
      tokens,
      (acc: ERC20Token[], token) => {
        const mainnetInfo = KATANA_TOKEN_TO_MAINNET[token.name]
        if (mainnetInfo) {
          acc.push({
            address: mainnetInfo.address,
            symbol: token.symbol,
            name: mainnetInfo.name,
            decimals: token.decimals,
            chainId: 1,
          })
        }
        return acc
      },
      [],
    )
  }

  private handleAjnaTokens(
    chainId: number,
    tokens: ERC20Token[],
    prices: Map<string, Price>,
  ): void {
    const ajnaAddress = AJNA_TOKENS[chainId]
    if (!ajnaAddress) return

    const ajnaToken = find(tokens, (t) => addressEquals(t.address, ajnaAddress))
    if (!ajnaToken || prices.has(ajnaToken.address.toLowerCase())) return

    const mainnetAjnaAddress = AJNA_TOKENS[1]
    if (!mainnetAjnaAddress) return

    this.limit(async () => {
      try {
        const url = `${this.baseUrl}/prices/current/ethereum:${mainnetAjnaAddress}`
        const response = await axios.get<LlamaPrice>(url, {
          timeout: 10000,
          headers: { 'User-Agent': 'yearn-pricing-service' },
        })

        const data = response.data?.coins[`ethereum:${mainnetAjnaAddress}`]
        if (data && data.price > 0) {
          prices.set(ajnaToken.address.toLowerCase(), {
            address: ajnaToken.address,
            price: parseUnits(data.price.toString(), 6),
            source: PriceSource.DEFILLAMA,
          })
        }
      } catch (error) {
        logger.error(`Failed to fetch Ajna price for chain ${chainId}:`, error)
      }
    })
  }
}

export default new DefilllamaFetcher()
