/**
 * Custom error types for better error handling and debugging
 * Inspired by ypricemagic's exception hierarchy
 */

export class PriceError extends Error {
  constructor(
    public token: string,
    public chainId: number,
    message: string,
  ) {
    super(`[Chain ${chainId}] ${token}: ${message}`)
    this.name = 'PriceError'
  }
}

export class ContractCallError extends Error {
  constructor(
    public address: string,
    public method: string,
    public chainId: number,
    public originalError: any,
  ) {
    super(`Contract call failed: ${address}.${method}() on chain ${chainId}`)
    this.name = 'ContractCallError'
    this.cause = originalError
  }
}

export class TokenTypeError extends Error {
  constructor(
    public token: string,
    public chainId: number,
    message: string,
  ) {
    super(`[Chain ${chainId}] ${token}: ${message}`)
    this.name = 'TokenTypeError'
  }
}

export class UnderlyingPriceError extends PriceError {
  constructor(
    public vaultToken: string,
    public underlyingToken: string,
    public chainId: number,
  ) {
    super(vaultToken, chainId, `Missing price for underlying token: ${underlyingToken}`)
    this.name = 'UnderlyingPriceError'
  }
}

export class MulticallTimeoutError extends Error {
  constructor(
    public chainId: number,
    public batchSize: number,
    public timeout: number,
  ) {
    super(`Multicall timeout after ${timeout}ms for ${batchSize} calls on chain ${chainId}`)
    this.name = 'MulticallTimeoutError'
  }
}
