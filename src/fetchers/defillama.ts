import axios from 'axios';
import pLimit from 'p-limit';
import { 
  ERC20Token, 
  Price, 
  LlamaPrice, 
  PriceSource
} from '../models';
import { 
  parseUnits, 
  addressEquals, 
  chunk,
  logger 
} from '../utils';
import { priceCache } from '../utils/priceCache';

const LLAMA_CHAIN_NAMES: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  100: 'xdai',
  137: 'polygon',
  250: 'fantom',
  8453: 'base',
  42161: 'arbitrum',
  747474: 'katana'
};

const AJNA_TOKENS: Record<number, string> = {
  1: '0x9a96ec9B57Fb64FbC60B423d1f4da7691Bd35079',
  10: '0x6c518f9D1a163379235816c543E62922a79863Fa',
  100: '0x67Ee2155601e168F7777F169Cd74f3E22BB5E0cE',
  137: '0xA63b19647787Da652D0826424460D1BBf43Bf9c6',
  8453: '0xf0f326af3b1Ed943ab95C29470730CC8Cf66ae47',
  42161: '0xA98c94d67D9dF259Bee2E7b519dF75aB00E3E2A8'
};

const KATANA_TOKEN_NAMES_TO_MAINNET: Record<string, string> = {
  'Vault Bridge WBTC': 'Wrapped BTC',
  'Vault Bridge USDC': 'USD Coin',
  'Vault Bridge USDT': 'Tether USD',
  'Vault Bridge USDS': 'USDS Stablecoin',
  'Vault Bridge ETH': 'Wrapped Ether',
  'AUSD': 'AUSD'
};

interface DefiLlamaFetcher {
  fetchPrices(chainId: number, tokens: ERC20Token[]): Promise<Map<string, Price>>;
}

export class DefilllamaFetcher implements DefiLlamaFetcher {
  private readonly baseUrl = 'https://coins.llama.fi';
  private readonly limit = pLimit(10); // Increased concurrency
  private readonly BATCH_SIZE = 200; // Increased from 50 to 200

  async fetchPrices(chainId: number, tokens: ERC20Token[]): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>();
    const chainName = LLAMA_CHAIN_NAMES[chainId];
    
    if (!chainName) {
      logger.warn(`Chain ${chainId} not supported by DeFiLlama`);
      return prices;
    }

    if (chainId === 747474) {
      return this.fetchKatanaPrices(tokens);
    }

    // Check cache first
    const cachedPrices = priceCache.getMany(chainId, tokens.map(t => t.address));
    cachedPrices.forEach((price, address) => {
      prices.set(address, price);
    });

    // Filter out tokens that are already cached
    const uncachedTokens = tokens.filter(t => !prices.has(t.address.toLowerCase()));
    
    if (uncachedTokens.length === 0) {
      logger.info(`DeFiLlama: All ${tokens.length} prices from cache`);
      return prices;
    }

    logger.info(`DeFiLlama: ${cachedPrices.size} from cache, fetching ${uncachedTokens.length} tokens`);

    // Split into larger chunks and fetch in parallel
    const tokenChunks = chunk(uncachedTokens, this.BATCH_SIZE);
    const results = await Promise.all(
      tokenChunks.map(chunk => 
        this.limit(() => this.fetchChunkPrices(chainName, chainId, chunk))
      )
    );

    // Combine results and cache them
    const symbolMap = new Map<string, string>();
    tokens.forEach(t => symbolMap.set(t.address.toLowerCase(), t.symbol));

    results.forEach(chunkPrices => {
      chunkPrices.forEach((price, address) => {
        prices.set(address, price);
        // Cache the new price
        priceCache.set(chainId, address, price, symbolMap.get(address));
      });
    });

    this.handleAjnaTokens(chainId, tokens, prices);

    return prices;
  }

  private async fetchChunkPrices(
    chainName: string, 
    chainId: number, 
    tokens: ERC20Token[]
  ): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>();
    
    try {
      const addresses = tokens.map(t => `${chainName}:${t.address}`).join(',');
      const url = `${this.baseUrl}/prices/current/${addresses}`;
      
      // Log major tokens being requested
      const majorTokens = tokens.filter(t => 
        t.symbol === 'WETH' || t.symbol === 'USDC' || t.symbol === 'USDT' || t.symbol === 'DAI'
      );
      if (majorTokens.length > 0 && chainId === 1) {
        logger.info(`Fetching prices for major tokens on Ethereum:`, 
          majorTokens.map(t => `${t.symbol}: ${t.address}`)
        );
      }
      
      const response = await axios.get<LlamaPrice>(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'yearn-pricing-service'
        }
      });

      if (response.data?.coins) {
        // Log if we got prices for major tokens
        if (chainId === 1) {
          const receivedAddresses = Object.keys(response.data.coins).map(k => k.split(':')[1]?.toLowerCase());
          const majorMissing = majorTokens.filter(t => 
            !receivedAddresses.includes(t.address.toLowerCase())
          );
          if (majorMissing.length > 0) {
            logger.warn(`DeFiLlama missing prices for major tokens:`, 
              majorMissing.map(t => `${t.symbol}: ${t.address}`)
            );
          }
        }
        
        Object.entries(response.data.coins).forEach(([key, data]) => {
          const address = key.split(':')[1];
          if (address && data.price > 0) {
            const token = tokens.find(t => addressEquals(t.address, address));
            if (token) {
              prices.set(token.address.toLowerCase(), {
                address: token.address,
                price: parseUnits(data.price.toString(), 6),
                humanizedPrice: data.price,
                source: PriceSource.DEFILLAMA
              });
            }
          }
        });
      }
    } catch (error) {
      logger.error(`DeFiLlama fetch error for chain ${chainId}:`, error);
    }

    logger.info(`DeFiLlama returned ${prices.size} prices`);
    return prices;
  }

  private async fetchKatanaPrices(tokens: ERC20Token[]): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>();
    
    const mainnetTokens = await this.getMainnetTokensForKatana(tokens);
    if (mainnetTokens.length === 0) {
      return prices;
    }

    const mainnetPrices = await this.fetchChunkPrices('ethereum', 1, mainnetTokens);
    
    tokens.forEach(token => {
      const mainnetName = KATANA_TOKEN_NAMES_TO_MAINNET[token.name];
      if (mainnetName) {
        const mainnetToken = mainnetTokens.find(t => t.name === mainnetName);
        if (mainnetToken) {
          const price = mainnetPrices.get(mainnetToken.address.toLowerCase());
          if (price) {
            prices.set(token.address.toLowerCase(), {
              ...price,
              address: token.address
            });
          }
        }
      }
    });

    return prices;
  }

  private async getMainnetTokensForKatana(tokens: ERC20Token[]): Promise<ERC20Token[]> {
    const mainnetTokens: ERC20Token[] = [];
    
    for (const token of tokens) {
      const mainnetName = KATANA_TOKEN_NAMES_TO_MAINNET[token.name];
      if (mainnetName) {
        mainnetTokens.push({
          address: '0x0000000000000000000000000000000000000000',
          symbol: token.symbol,
          name: mainnetName,
          decimals: token.decimals,
          chainId: 1
        });
      }
    }

    return mainnetTokens;
  }

  private handleAjnaTokens(
    chainId: number, 
    tokens: ERC20Token[], 
    prices: Map<string, Price>
  ): void {
    const ajnaAddress = AJNA_TOKENS[chainId];
    if (!ajnaAddress) return;

    const ajnaToken = tokens.find(t => addressEquals(t.address, ajnaAddress));
    if (!ajnaToken || prices.has(ajnaToken.address.toLowerCase())) return;

    const mainnetAjnaAddress = AJNA_TOKENS[1];
    if (!mainnetAjnaAddress) return;

    this.limit(async () => {
      try {
        const url = `${this.baseUrl}/prices/current/ethereum:${mainnetAjnaAddress}`;
        const response = await axios.get<LlamaPrice>(url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'yearn-pricing-service'
          }
        });

        const data = response.data?.coins[`ethereum:${mainnetAjnaAddress}`];
        if (data && data.price > 0) {
          prices.set(ajnaToken.address.toLowerCase(), {
            address: ajnaToken.address,
            price: parseUnits(data.price.toString(), 6),
            humanizedPrice: data.price,
            source: PriceSource.DEFILLAMA
          });
        }
      } catch (error) {
        logger.error(`Failed to fetch Ajna price for chain ${chainId}:`, error);
      }
    });
  }
}

export default new DefilllamaFetcher();