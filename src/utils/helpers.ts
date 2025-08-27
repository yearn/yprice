export function toChecksumAddress(address: string): string {
  // Use ethers to properly checksum the address
  try {
    const { getAddress } = require('ethers');
    return getAddress(address);
  } catch {
    // Fallback to simple implementation if ethers is not available
    // This is a simplified version and not EIP-55 compliant
    const addr = address.toLowerCase().replace('0x', '');
    let result = '';
    
    for (let i = 0; i < addr.length; i++) {
      const char = addr[i];
      // This is a simplified checksum - proper EIP-55 requires keccak256
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
  
  // Convert to string and handle scientific notation
  let valueStr = typeof value === 'number' ? value.toString() : value;
  
  // Handle scientific notation (e.g., "1.23e-9", "1.23e+6")
  if (valueStr.includes('e') || valueStr.includes('E')) {
    const num = parseFloat(valueStr);
    if (isNaN(num)) {
      return BigInt(0);
    }
    
    // For very small numbers, return 0 or 1 (minimum unit)
    if (num < 1e-18) {
      return BigInt(0);
    }
    
    // Convert to fixed notation with enough decimal places
    valueStr = num.toFixed(Math.max(decimals, 18));
  }
  
  const parts = valueStr.split('.');
  if (parts.length === 1) {
    // No decimal part
    try {
      return BigInt(parts[0]!) * factor;
    } catch {
      return BigInt(0);
    }
  }
  
  // Has decimal part
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

export function humanizePrice(price: bigint, decimals: number = 6): number {
  const formatted = formatUnits(price, decimals);
  return parseFloat(formatted);
}

export function addressEquals(addr1: string, addr2: string): boolean {
  return addr1.toLowerCase() === addr2.toLowerCase();
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function stringToBool(value: string | undefined): boolean {
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

export function safeString(value: any, defaultValue: string = ''): string {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  return String(value);
}