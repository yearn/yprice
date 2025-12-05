import { MulticallTimeoutError } from 'models/errors'
import pLimit from 'p-limit'
import { logger } from 'utils/logger'
import { getPublicClient } from 'utils/viemClients'

interface MulticallRequest {
  address: `0x${string}`
  abi: any
  functionName: string
  args?: any[]
  resolver?: (result: any) => void
  rejecter?: (error: any) => void
}

interface QueuedRequest extends MulticallRequest {
  id: string
  timestamp: number
}

/**
 * Unified Multicall Aggregator Service
 * Batches all on-chain reads into efficient multicalls
 */
export class MulticallAggregator {
  private queues: Map<number, QueuedRequest[]> = new Map()
  private timers: Map<number, NodeJS.Timeout> = new Map()
  private processing: Map<number, boolean> = new Map()

  // Configuration
  private readonly BATCH_SIZES: Record<number, number> = {
    1: 500, // Ethereum
    10: 1000, // Optimism (cheaper gas)
    100: 750, // Gnosis
    137: 750, // Polygon
    250: 500, // Fantom
    8453: 1000, // Base (cheap L2)
    42161: 1000, // Arbitrum (cheap L2)
  }
  private readonly DEFAULT_BATCH_SIZE = 500
  private readonly QUEUE_WINDOW = 10 // ms to wait for more calls
  private readonly MAX_RETRIES = 3
  private readonly CALL_TIMEOUT = 30000 // 30 seconds

  // Rate limiting for each chain
  private limiters: Map<number, ReturnType<typeof pLimit>> = new Map()

  constructor() {
    // Initialize rate limiters for each chain
    // Increased from 10 to 40 to support parallel service execution
    // This allows 4 services to run with ~10 slots each
    const concurrentLimit = process.env.MULTICALL_CONCURRENT_LIMIT
      ? parseInt(process.env.MULTICALL_CONCURRENT_LIMIT, 10)
      : 40

    ;[1, 10, 100, 137, 250, 8453, 42161].forEach((chainId) => {
      this.limiters.set(chainId, pLimit(concurrentLimit))
    })

    logger.debug(
      `MulticallAggregator initialized with ${concurrentLimit} concurrent multicalls per chain`,
    )
  }

  /**
   * Get batch size for a specific chain
   */
  private getBatchSize(chainId: number): number {
    return this.BATCH_SIZES[chainId] || this.DEFAULT_BATCH_SIZE
  }

  /**
   * Queue a contract call for batching
   */
  async queueCall<T = any>(
    chainId: number,
    request: Omit<MulticallRequest, 'resolver' | 'rejecter'>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        ...request,
        id: `${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        resolver: resolve,
        rejecter: reject,
      }

      this.addToQueue(chainId, queuedRequest)
    })
  }

  /**
   * Queue multiple calls at once
   */
  async queueCalls<T = any>(
    chainId: number,
    requests: Array<Omit<MulticallRequest, 'resolver' | 'rejecter'>>,
  ): Promise<T[]> {
    const promises = requests.map((request) => this.queueCall<T>(chainId, request))
    return Promise.all(promises)
  }

  /**
   * Execute batched calls immediately for a chain
   */
  async executeBatch(chainId: number): Promise<void> {
    const queue = this.queues.get(chainId)
    if (!queue || queue.length === 0) return

    // Clear any pending timer
    const timer = this.timers.get(chainId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(chainId)
    }

    // Process the queue
    await this.processQueue(chainId)
  }

  /**
   * Add request to queue and schedule processing
   */
  private addToQueue(chainId: number, request: QueuedRequest): void {
    // Initialize queue if needed
    if (!this.queues.has(chainId)) {
      this.queues.set(chainId, [])
    }

    const queue = this.queues.get(chainId)!
    queue.push(request)

    // If we've hit the batch size, process immediately
    const batchSize = this.getBatchSize(chainId)
    if (queue.length >= batchSize) {
      this.processQueueImmediate(chainId)
      return
    }

    // Otherwise, schedule processing after window
    this.scheduleProcessing(chainId)
  }

  /**
   * Schedule queue processing after window
   */
  private scheduleProcessing(chainId: number): void {
    // Clear existing timer if any
    const existingTimer = this.timers.get(chainId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.processQueueImmediate(chainId)
    }, this.QUEUE_WINDOW)

    this.timers.set(chainId, timer)
  }

  /**
   * Process queue immediately
   */
  private processQueueImmediate(chainId: number): void {
    // Clear timer
    const timer = this.timers.get(chainId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(chainId)
    }

    // Process if not already processing
    if (!this.processing.get(chainId)) {
      this.processQueue(chainId)
    }
  }

  /**
   * Process queued requests for a chain
   */
  private async processQueue(chainId: number): Promise<void> {
    const queue = this.queues.get(chainId)
    if (!queue || queue.length === 0) return

    // Mark as processing
    this.processing.set(chainId, true)

    try {
      const limiter = this.limiters.get(chainId) || pLimit(10)
      const batchSize = this.getBatchSize(chainId)

      // Process in batches
      while (queue.length > 0) {
        const batch = queue.splice(0, batchSize)

        // Execute batch with rate limiting
        await limiter(async () => {
          await this.executeBatchedCalls(chainId, batch)
        })
      }
    } finally {
      this.processing.set(chainId, false)
    }
  }

  /**
   * Execute a batch of calls via multicall
   */
  private async executeBatchedCalls(chainId: number, batch: QueuedRequest[]): Promise<void> {
    const client = getPublicClient(chainId)

    // Prepare contracts for multicall
    const contracts = batch.map((req) => ({
      address: req.address,
      abi: req.abi,
      functionName: req.functionName,
      args: req.args || [],
    }))

    let attempt = 0
    let lastError: any

    while (attempt < this.MAX_RETRIES) {
      try {
        // Create timeout promise (always rejects, never resolves)
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new MulticallTimeoutError(chainId, batch.length, this.CALL_TIMEOUT)),
            this.CALL_TIMEOUT,
          ),
        )

        // Execute multicall with timeout
        const multicallPromise = client.multicall({
          contracts,
          allowFailure: true,
        })

        const results = await Promise.race([multicallPromise, timeoutPromise])

        // Resolve/reject promises based on results
        batch.forEach((req, index) => {
          const result = results[index]

          if (result && result.status === 'success') {
            req.resolver?.(result.result)
          } else {
            req.rejecter?.(result?.error || new Error('Multicall failed'))
          }
        })

        // Success - log stats
        const successCount = results.filter((r: any) => r.status === 'success').length
        logger.debug(
          `Multicall completed for chain ${chainId}: ${successCount}/${batch.length} successful`,
        )

        return
      } catch (error) {
        lastError = error
        attempt++

        if (attempt < this.MAX_RETRIES) {
          const errorType = error instanceof MulticallTimeoutError ? 'timeout' : 'error'
          logger.warn(
            `Multicall ${errorType} for chain ${chainId}, attempt ${attempt}/${this.MAX_RETRIES}`,
            error,
          )

          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100))
        }
      }
    }

    // All retries failed - reject all promises
    logger.error(
      `Multicall failed after ${this.MAX_RETRIES} attempts for chain ${chainId}`,
      lastError,
    )
    batch.forEach((req) => {
      req.rejecter?.(lastError || new Error('Multicall failed after retries'))
    })
  }

  /**
   * Get queue statistics
   */
  getStats(): Map<number, { queued: number; processing: boolean }> {
    const stats = new Map()

    for (const [chainId, queue] of this.queues) {
      stats.set(chainId, {
        queued: queue.length,
        processing: this.processing.get(chainId) || false,
      })
    }

    return stats
  }

  /**
   * Clear all queues (emergency use only)
   */
  clearAll(): void {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()

    // Reject all pending requests
    for (const queue of this.queues.values()) {
      queue.forEach((req) => {
        req.rejecter?.(new Error('Queue cleared'))
      })
    }
    this.queues.clear()

    // Reset processing flags
    this.processing.clear()

    logger.warn('Multicall aggregator: All queues cleared')
  }
}

// Singleton instance
export const multicallAggregator = new MulticallAggregator()

// Helper function for easy use
export async function batchReadContract<T = any>(
  chainId: number,
  address: `0x${string}`,
  abi: any,
  functionName: string,
  args?: any[],
): Promise<T> {
  return multicallAggregator.queueCall<T>(chainId, {
    address,
    abi,
    functionName,
    args,
  })
}

// Helper for multiple reads
export async function batchReadContracts<T = any>(
  chainId: number,
  contracts: Array<{
    address: `0x${string}`
    abi: any
    functionName: string
    args?: any[]
  }>,
): Promise<Array<{ status: 'success' | 'failure'; result?: T; error?: any }>> {
  try {
    const results = await multicallAggregator.queueCalls<T>(chainId, contracts)
    return results.map((result) => ({
      status: 'success' as const,
      result,
    }))
  } catch (error) {
    // If the entire batch fails, return failures for all
    return contracts.map(() => ({
      status: 'failure' as const,
      error,
    }))
  }
}
