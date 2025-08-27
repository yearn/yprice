import {
  parseUnits,
  formatUnits,
  humanizePrice,
  addressEquals,
  chunk,
  stringToBool,
  safeString
} from '../src/utils/helpers';

describe('Utils', () => {
  describe('parseUnits', () => {
    it('should parse integer values correctly', () => {
      expect(parseUnits('1', 6)).toEqual(BigInt(1000000));
      expect(parseUnits('100', 18)).toEqual(BigInt('100000000000000000000'));
    });

    it('should parse decimal values correctly', () => {
      expect(parseUnits('1.5', 6)).toEqual(BigInt(1500000));
      expect(parseUnits('0.123456', 6)).toEqual(BigInt(123456));
    });

    it('should handle number inputs', () => {
      expect(parseUnits(1, 6)).toEqual(BigInt(1000000));
      expect(parseUnits(1.5, 6)).toEqual(BigInt(1500000));
    });
  });

  describe('formatUnits', () => {
    it('should format integer values correctly', () => {
      expect(formatUnits(BigInt(1000000), 6)).toBe('1');
      expect(formatUnits(BigInt('100000000000000000000'), 18)).toBe('100');
    });

    it('should format decimal values correctly', () => {
      expect(formatUnits(BigInt(1500000), 6)).toBe('1.5');
      expect(formatUnits(BigInt(123456), 6)).toBe('0.123456');
    });

    it('should trim trailing zeros', () => {
      expect(formatUnits(BigInt(1000000), 6)).toBe('1');
      expect(formatUnits(BigInt(1500000), 6)).toBe('1.5');
    });
  });

  describe('humanizePrice', () => {
    it('should convert bigint to human-readable number', () => {
      expect(humanizePrice(BigInt(1000000), 6)).toBe(1);
      expect(humanizePrice(BigInt(1500000), 6)).toBe(1.5);
      expect(humanizePrice(BigInt(123456), 6)).toBe(0.123456);
    });
  });

  describe('addressEquals', () => {
    it('should compare addresses case-insensitively', () => {
      expect(addressEquals('0xABC', '0xabc')).toBe(true);
      expect(addressEquals('0xABC', '0xABC')).toBe(true);
      expect(addressEquals('0xABC', '0xDEF')).toBe(false);
    });
  });

  describe('chunk', () => {
    it('should split array into chunks', () => {
      const arr = [1, 2, 3, 4, 5, 6, 7];
      expect(chunk(arr, 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
      expect(chunk(arr, 2)).toEqual([[1, 2], [3, 4], [5, 6], [7]]);
    });

    it('should handle empty arrays', () => {
      expect(chunk([], 3)).toEqual([]);
    });
  });

  describe('stringToBool', () => {
    it('should convert truthy strings to true', () => {
      expect(stringToBool('true')).toBe(true);
      expect(stringToBool('1')).toBe(true);
      expect(stringToBool('yes')).toBe(true);
      expect(stringToBool('on')).toBe(true);
    });

    it('should convert falsy strings to false', () => {
      expect(stringToBool('false')).toBe(false);
      expect(stringToBool('0')).toBe(false);
      expect(stringToBool('no')).toBe(false);
      expect(stringToBool(undefined)).toBe(false);
    });
  });

  describe('safeString', () => {
    it('should convert values to strings safely', () => {
      expect(safeString('hello')).toBe('hello');
      expect(safeString(123)).toBe('123');
      expect(safeString(null)).toBe('');
      expect(safeString(undefined)).toBe('');
      expect(safeString(null, 'default')).toBe('default');
    });
  });
});