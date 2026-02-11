import { Price } from 'models/index'

export interface StorageInterface {
  storePrice(chainId: number, price: Price): Promise<void>
  storePrices(chainId: number, prices: Price[]): Promise<void>
  getPrice(chainId: number, address: string): Promise<Price | undefined>
  listPrices(chainId: number): Promise<{ asMap: Map<string, Price>; asSlice: Price[] }>
  getAllPrices(): Promise<Map<number, Map<string, Price>>>
  clearCache(chainId?: number): Promise<void>
  getStats(chainId?: number): Promise<any>
}
