import lodash from 'lodash'
import { getAddress } from 'viem'

const { chunk } = lodash

export const toChecksumAddress = (address: string): string => {
  try {
    return getAddress(address)
  } catch {
    const addr = address.toLowerCase().replace('0x', '')
    return (
      '0x' +
      addr
        .split('')
        .map((char) => (char && parseInt(char, 16) >= 8 ? char.toUpperCase() : char))
        .join('')
    )
  }
}

export const parseUnits = (value: string | number, decimals: number): bigint => {
  const factor = BigInt(10) ** BigInt(decimals)
  let valueStr = typeof value === 'number' ? value.toString() : value

  if (valueStr.match(/[eE]/)) {
    const num = parseFloat(valueStr)
    if (Number.isNaN(num) || num < 1e-18) return BigInt(0)
    valueStr = num.toFixed(Math.max(decimals, 18))
  }

  const [intPart, decPart] = valueStr.split('.')
  if (!decPart) {
    try {
      return BigInt(intPart!) * factor
    } catch {
      return BigInt(0)
    }
  }

  try {
    const decimalStr = decPart.padEnd(decimals, '0').slice(0, decimals)
    return (
      BigInt(intPart || '0') * factor +
      BigInt(decimalStr) * (factor / BigInt(10) ** BigInt(decimalStr.length))
    )
  } catch {
    return BigInt(0)
  }
}

export const formatUnits = (value: bigint, decimals: number): string => {
  const factor = BigInt(10) ** BigInt(decimals)
  const integer = value / factor
  const remainder = value % factor
  return remainder === BigInt(0)
    ? integer.toString()
    : `${integer}.${remainder.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

export const humanizePrice = (price: bigint, decimals: number = 6): number =>
  parseFloat(formatUnits(price, decimals))

export const addressEquals = (addr1: string, addr2: string): boolean =>
  addr1.toLowerCase() === addr2.toLowerCase()

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const stringToBool = (value?: string): boolean =>
  !!value && ['true', '1', 'yes', 'on'].includes(value.toLowerCase())

export const safeString = (value: any, defaultValue = ''): string => value ?? defaultValue

export { chunk }

export const deduplicateTokens = <T extends { chainId: number; address: string }>(
  tokens: T[],
): T[] => {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const token of tokens) {
    const key = `${token.chainId}-${token.address.toLowerCase()}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(token)
    }
  }
  return unique
}
