import { Price } from 'models/index'

export interface StorageInterface {
  storePrice(chainId: number, price: Price): void | Promise<void>
  storePrices(chainId: number, prices: Price[]): void | Promise<void>
  getPrice(chainId: number, address: string): Price | undefined | Promise<Price | undefined>
  listPrices(
    chainId: number,
  ):
    | { asMap: Map<string, Price>; asSlice: Price[] }
    | Promise<{ asMap: Map<string, Price>; asSlice: Price[] }>
  getAllPrices(): Map<number, Map<string, Price>> | Promise<Map<number, Map<string, Price>>>
  clearCache(chainId?: number): void | Promise<void>
  getStats(chainId?: number): any | Promise<any>
}
