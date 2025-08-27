import { ethers } from 'ethers';
import { TokenInfo } from './types';
import { logger } from '../utils';

const COMPOUND_COMPTROLLER_ABI = [
  'function getAllMarkets() view returns (address[])',
];

const CTOKEN_ABI = [
  'function underlying() view returns (address)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
];

export class CompoundDiscovery {
  private chainId: number;
  private comptrollerAddress?: string;
  private provider?: ethers.Provider;

  constructor(chainId: number, comptrollerAddress?: string, rpcUrl?: string) {
    this.chainId = chainId;
    this.comptrollerAddress = comptrollerAddress;
    
    if (rpcUrl && comptrollerAddress) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
  }

  async discoverTokens(): Promise<TokenInfo[]> {
    const tokens: TokenInfo[] = [];

    if (!this.provider || !this.comptrollerAddress) {
      return tokens;
    }

    try {
      const comptroller = new ethers.Contract(
        this.comptrollerAddress,
        COMPOUND_COMPTROLLER_ABI,
        this.provider
      );

      // Get all cToken markets
      const markets = await (comptroller as any).getAllMarkets();
      
      logger.info(`Chain ${this.chainId}: Found ${markets.length} Compound markets`);

      for (const cTokenAddress of markets) {
        // Add cToken
        tokens.push({
          address: cTokenAddress.toLowerCase(),
          chainId: this.chainId,
          source: 'compound-ctoken',
        });

        // Get underlying token
        try {
          const cToken = new ethers.Contract(
            cTokenAddress,
            CTOKEN_ABI,
            this.provider
          );

          // cETH doesn't have underlying (it's native ETH)
          try {
            const underlying = await (cToken as any).underlying();
            if (underlying && underlying !== '0x0000000000000000000000000000000000000000') {
              tokens.push({
                address: underlying.toLowerCase(),
                chainId: this.chainId,
                source: 'compound-underlying',
              });
            }
          } catch {
            // This is likely cETH or similar, which doesn't have underlying
            logger.debug(`No underlying for cToken ${cTokenAddress} - likely native asset wrapper`);
          }
        } catch (error) {
          logger.debug(`Failed to get underlying for cToken ${cTokenAddress}:`, error);
        }
      }

      logger.info(`Chain ${this.chainId}: Discovered ${tokens.length} Compound tokens`);
    } catch (error) {
      logger.error(`Compound discovery failed for chain ${this.chainId}:`, error);
    }

    return this.deduplicateTokens(tokens);
  }

  private deduplicateTokens(tokens: TokenInfo[]): TokenInfo[] {
    const seen = new Set<string>();
    const unique: TokenInfo[] = [];

    for (const token of tokens) {
      const key = `${token.chainId}-${token.address.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(token);
      }
    }

    return unique;
  }
}