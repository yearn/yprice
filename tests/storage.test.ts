import { PriceStorage } from '../src/storage/priceStorage';
import { Price, PriceSource } from '../src/models';

describe('PriceStorage', () => {
  let storage: PriceStorage;

  beforeEach(() => {
    storage = new PriceStorage(60, './test-data');
  });

  afterEach(() => {
    storage.clearCache();
  });

  describe('storePrice', () => {
    it('should store a price successfully', () => {
      const price: Price = {
        address: '0x123',
        price: BigInt(1000000),
        humanizedPrice: 1.0,
        source: PriceSource.DEFILLAMA
      };

      storage.storePrice(1, price);
      const retrieved = storage.getPrice(1, '0x123');
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.price).toEqual(BigInt(1000000));
      expect(retrieved?.source).toBe(PriceSource.DEFILLAMA);
    });

    it('should normalize addresses to lowercase', () => {
      const price: Price = {
        address: '0xABC',
        price: BigInt(2000000),
        humanizedPrice: 2.0,
        source: PriceSource.COINGECKO
      };

      storage.storePrice(1, price);
      const retrieved = storage.getPrice(1, '0xabc');
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.address).toBe('0xabc');
    });
  });

  describe('storePrices', () => {
    it('should store multiple prices at once', () => {
      const prices: Price[] = [
        {
          address: '0x111',
          price: BigInt(1000000),
          humanizedPrice: 1.0,
          source: PriceSource.DEFILLAMA
        },
        {
          address: '0x222',
          price: BigInt(2000000),
          humanizedPrice: 2.0,
          source: PriceSource.COINGECKO
        }
      ];

      storage.storePrices(1, prices);
      
      const price1 = storage.getPrice(1, '0x111');
      const price2 = storage.getPrice(1, '0x222');
      
      expect(price1).toBeDefined();
      expect(price2).toBeDefined();
      expect(price1?.price).toEqual(BigInt(1000000));
      expect(price2?.price).toEqual(BigInt(2000000));
    });
  });

  describe('listPrices', () => {
    it('should return prices as map and slice', () => {
      const prices: Price[] = [
        {
          address: '0x111',
          price: BigInt(1000000),
          humanizedPrice: 1.0,
          source: PriceSource.DEFILLAMA
        },
        {
          address: '0x222',
          price: BigInt(2000000),
          humanizedPrice: 2.0,
          source: PriceSource.COINGECKO
        }
      ];

      storage.storePrices(1, prices);
      const { asMap, asSlice } = storage.listPrices(1);
      
      expect(asMap.size).toBe(2);
      expect(asSlice.length).toBe(2);
      expect(asMap.has('0x111')).toBe(true);
      expect(asMap.has('0x222')).toBe(true);
    });
  });

  describe('getAllPrices', () => {
    it('should return prices for all chains', () => {
      const ethPrice: Price = {
        address: '0x111',
        price: BigInt(1000000),
        humanizedPrice: 1.0,
        source: PriceSource.DEFILLAMA
      };

      const polyPrice: Price = {
        address: '0x222',
        price: BigInt(2000000),
        humanizedPrice: 2.0,
        source: PriceSource.COINGECKO
      };

      storage.storePrice(1, ethPrice);
      storage.storePrice(137, polyPrice);
      
      const allPrices = storage.getAllPrices();
      
      expect(allPrices.size).toBeGreaterThan(0);
      expect(allPrices.get(1)?.has('0x111')).toBe(true);
      expect(allPrices.get(137)?.has('0x222')).toBe(true);
    });
  });

  describe('clearCache', () => {
    it('should clear cache for specific chain', () => {
      const price: Price = {
        address: '0x123',
        price: BigInt(1000000),
        humanizedPrice: 1.0,
        source: PriceSource.DEFILLAMA
      };

      storage.storePrice(1, price);
      storage.clearCache(1);
      
      const retrieved = storage.getPrice(1, '0x123');
      expect(retrieved).toBeUndefined();
    });

    it('should clear all caches', () => {
      const price1: Price = {
        address: '0x111',
        price: BigInt(1000000),
        humanizedPrice: 1.0,
        source: PriceSource.DEFILLAMA
      };

      const price2: Price = {
        address: '0x222',
        price: BigInt(2000000),
        humanizedPrice: 2.0,
        source: PriceSource.COINGECKO
      };

      storage.storePrice(1, price1);
      storage.storePrice(137, price2);
      storage.clearCache();
      
      expect(storage.getPrice(1, '0x111')).toBeUndefined();
      expect(storage.getPrice(137, '0x222')).toBeUndefined();
    });
  });
});