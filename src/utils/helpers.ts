import { chunk } from 'lodash';

export function toChecksumAddress(address: string): string {
  try {
    const { getAddress } = require('ethers');
    return getAddress(address);
  } catch {
    const addr = address.toLowerCase().replace('0x', '');
    let result = '';
    
    for (let i = 0; i < addr.length; i++) {
      const char = addr[i];
      if (char && parseInt(char, 16) >= 8) {
        result += char.toUpperCase();
      } else if (char) {
        result += char;
      }
    }
    
    return '0x' + result;
  }
}

export function parseUnits(value: string | number, decimals: number): bigint {
  const factor = BigInt(10) ** BigInt(decimals);
  
  let valueStr = typeof value === 'number' ? value.toString() : value;
  
  if (valueStr.includes('e') || valueStr.includes('E')) {
    const num = parseFloat(valueStr);
    if (isNaN(num)) return BigInt(0);
    if (num < 1e-18) return BigInt(0);
    valueStr = num.toFixed(Math.max(decimals, 18));
  }
  
  const parts = valueStr.split('.');
  if (parts.length === 1) {
    try {
      return BigInt(parts[0]!) * factor;
    } catch {
      return BigInt(0);
    }
  }
  
  try {
    const integerPart = BigInt(parts[0] || '0') * factor;
    const decimalStr = parts[1]!.padEnd(decimals, '0').slice(0, decimals);
    const decimalPart = BigInt(decimalStr) * (factor / BigInt(10) ** BigInt(decimalStr.length));
    
    return integerPart + decimalPart;
  } catch {
    return BigInt(0);
  }
}

export function formatUnits(value: bigint, decimals: number): string {
  const factor = BigInt(10) ** BigInt(decimals);
  const integer = value / factor;
  const remainder = value % factor;
  
  if (remainder === BigInt(0)) {
    return integer.toString();
  }
  
  const remainderStr = remainder.toString().padStart(decimals, '0');
  const trimmed = remainderStr.replace(/0+$/, '');
  
  return `${integer}.${trimmed}`;
}

export const humanizePrice = (price: bigint, decimals: number = 6): number =>
  parseFloat(formatUnits(price, decimals));

export const addressEquals = (addr1: string, addr2: string): boolean =>
  addr1.toLowerCase() === addr2.toLowerCase();

export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export { chunk };

export const stringToBool = (value: string | undefined): boolean =>
  value ? ['true', '1', 'yes', 'on'].includes(value.toLowerCase()) : false;

export const safeString = (value: any, defaultValue: string = ''): string =>
  value === null || value === undefined ? defaultValue : String(value);