import axios from 'axios';
import pLimit from 'p-limit';
import { 
  ERC20Token, 
  Price, 
  GeckoPrice, 
  PriceSource 
} from '../models';
import { 
  parseUnits, 
  addressEquals, 
  chunk,
  logger,
  sleep 
} from '../utils';
import { priceCache } from '../utils/priceCache';

const GECKO_CHAIN_NAMES: Record<number, string> = {
  1: 'ethereum',
  10: 'optimistic-ethereum',
  100: 'xdai',
  137: 'polygon-pos',
  250: 'fantom',
  8453: 'base',
  42161: 'arbitrum-one'
};

interface CoinGeckoFetcher {
  fetchPrices(chainId: number, tokens: ERC20Token[]): Promise<Map<string, Price>>;
}

export class CoingeckoFetcher implements CoinGeckoFetcher {
  private readonly baseUrl = 'https://api.coingecko.com/api/v3';
  private readonly proUrl = 'https://pro-api.coingecko.com/api/v3';
  private readonly apiKey?: string;
  private readonly limit = pLimit(5); // Increased from 3 to 5
  private lastRequestTime = 0;
  private readonly minRequestInterval = 1100;
  private readonly BATCH_SIZE = 250; // Increased from 100 to 250 (API max)

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.COINGECKO_API_KEY;
  }

  async fetchPrices(chainId: number, tokens: ERC20Token[]): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>();
    const chainName = GECKO_CHAIN_NAMES[chainId];
    
    if (!chainName) {
      logger.warn(`Chain ${chainId} not supported by CoinGecko`);
      return prices;
    }

    // Check cache first
    const cachedPrices = priceCache.getMany(chainId, tokens.map(t => t.address));
    cachedPrices.forEach((price, address) => {
      prices.set(address, price);
    });

    // Filter out tokens that are already cached
    const uncachedTokens = tokens.filter(t => !prices.has(t.address.toLowerCase()));
    
    if (uncachedTokens.length === 0) {
      logger.info(`CoinGecko: All ${tokens.length} prices from cache`);
      return prices;
    }

    logger.info(`CoinGecko: ${cachedPrices.size} from cache, fetching ${uncachedTokens.length} tokens`);

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

    return prices;
  }

  private async fetchChunkPrices(
    chainName: string, 
    chainId: number, 
    tokens: ERC20Token[]
  ): Promise<Map<string, Price>> {
    const prices = new Map<string, Price>();
    
    await this.enforceRateLimit();
    
    try {
      const addresses = tokens.map(t => t.address).join(',');
      const baseUrl = this.apiKey ? this.proUrl : this.baseUrl;
      
      const params: any = {
        vs_currencies: 'usd',
        contract_addresses: addresses
      };

      if (this.apiKey) {
        params['x_cg_pro_api_key'] = this.apiKey;
      }

      const url = `${baseUrl}/simple/token_price/${chainName}`;
      const response = await axios.get<GeckoPrice>(url, {
        params,
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'yearn-pricing-service'
        }
      });

      if (response.data) {
        Object.entries(response.data).forEach(([address, data]) => {
          if (data.usd && data.usd > 0) {
            const token = tokens.find(t => addressEquals(t.address, address));
            if (token) {
              prices.set(token.address.toLowerCase(), {
                address: token.address,
                price: parseUnits(data.usd.toString(), 6),
                humanizedPrice: data.usd,
                source: PriceSource.COINGECKO
              });
            }
          }
        });
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        logger.warn('CoinGecko rate limit hit, backing off...');
        await sleep(5000);
      } else {
        logger.error(`CoinGecko fetch error for chain ${chainId}:`, error.message);
      }
    }

    return prices;
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const delay = this.minRequestInterval - timeSinceLastRequest;
      await sleep(delay);
    }
    
    this.lastRequestTime = Date.now();
  }

  async checkApiKeyStatus(): Promise<boolean> {
    if (!this.apiKey) {
      logger.info('No CoinGecko API key configured');
      return false;
    }

    try {
      const response = await axios.get(`${this.proUrl}/ping`, {
        params: { x_cg_pro_api_key: this.apiKey },
        timeout: 5000
      });

      if (response.data?.gecko_says) {
        logger.info('CoinGecko API key is valid');
        return true;
      }
    } catch (error) {
      logger.error('CoinGecko API key validation failed:', error);
    }

    return false;
  }
}

export default new CoingeckoFetcher();