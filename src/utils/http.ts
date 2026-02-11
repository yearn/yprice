import https from 'node:https'
import axios, { type AxiosRequestConfig } from 'axios'
import { logger } from 'utils/logger'

const httpsAgent = new https.Agent({ rejectUnauthorized: false })

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'yearn-pricing-service',
}

interface FetchJsonOptions {
  timeout?: number
  method?: 'GET' | 'POST'
  data?: any
  headers?: Record<string, string>
  retries?: number
}

export async function fetchJson<T>(url: string, opts?: FetchJsonOptions): Promise<T> {
  const { timeout = 30000, method = 'GET', data, headers, retries = 2 } = opts ?? {}

  const config: AxiosRequestConfig = {
    url,
    method,
    timeout,
    headers: { ...DEFAULT_HEADERS, ...headers },
    httpsAgent,
    data,
  }

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios(config)
      return response.data as T
    } catch (error: any) {
      lastError = error
      const status = error.response?.status
      const isRetryable =
        status === 429 || (status !== undefined && status >= 500) || error.code === 'ECONNABORTED'

      if (!isRetryable || attempt === retries) break

      const delay = Math.min(1000 * 2 ** attempt, 8000)
      logger.debug(`Retrying ${url} (attempt ${attempt + 1}/${retries}) after ${delay}ms`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }

  throw lastError
}

export function logError(context: string, chainId: number, error: unknown): void {
  const msg = error instanceof Error ? error.message.split('\n')[0] : String(error)
  logger.warn(
    `${context} failed for chain ${chainId}: ${(msg || 'Unknown error').substring(0, 150)}`,
  )
}
