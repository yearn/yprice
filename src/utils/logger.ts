import winston from 'winston'

const logLevel = process.env.LOG_LEVEL || 'info'
const silentMode = process.env.SILENT_MODE === 'true'
const VERBOSE_DISABLED = process.env.DISABLE_VERBOSE_LOGS === 'true'

const skipPatterns = [
  'DeFiLlama returned',
  'Fetching prices for',
  'Stored',
  'from cache',
  '[Velodrome]',
  'DeFiLlama:',
]

const customFormat = winston.format.printf(({ level, message }: any) => {
  if (level === 'error' && typeof message === 'object' && message.stack) {
    return `error: ${message.message || message.shortMessage || 'Unknown error'}`
  }

  if (logLevel !== 'debug' && skipPatterns.some((p) => message?.includes(p))) {
    return ''
  }

  return message || ''
})

export const logger = winston.createLogger({
  level: logLevel,
  silent: silentMode,
  format: winston.format.combine(winston.format.errors({ stack: true }), customFormat),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
  ],
})

export const setLogLevel = (level: string) => {
  logger.level = level
}

export const setSilentMode = (silent: boolean) => {
  logger.silent = silent
}

// Batch mode suppression
let batchMode = false
let suppressedLogs = 0

export const setBatchMode = (enabled: boolean) => {
  if (!enabled && suppressedLogs > 0) {
    logger.debug(`[Suppressed ${suppressedLogs} verbose logs during batch operation]`)
    suppressedLogs = 0
  }
  batchMode = enabled
}

export const isBatchMode = () => batchMode

// Verbose logging (suppressible)
export const verbose = (message: string, ...args: any[]) => {
  if (VERBOSE_DISABLED || batchMode) {
    suppressedLogs++
    return
  }
  logger.debug(message, ...args)
}

// Chain-specific logging
export const chainComplete = (
  chainId: number,
  tokensFound: number,
  pricesFound: number,
  duration: number,
) => {
  const successRate = tokensFound > 0 ? Math.round((pricesFound / tokensFound) * 100) : 0
  logger.info(
    `✅ Chain ${chainId}: ${pricesFound}/${tokensFound} prices (${successRate}%) in ${(duration / 1000).toFixed(1)}s`,
  )
}

// Summary logging
export const summary = (stats: {
  totalChains: number
  totalTokens: number
  totalPrices: number
  duration: number
  errors: number
}) => {
  const successRate =
    stats.totalTokens > 0 ? Math.round((stats.totalPrices / stats.totalTokens) * 100) : 0

  logger.info('')
  logger.info('=== 💰 PRICING SUMMARY ===')
  logger.info(`Chains processed: ${stats.totalChains}`)
  logger.info(`Total tokens: ${stats.totalTokens}`)
  logger.info(`Prices found: ${stats.totalPrices} (${successRate}%)`)
  logger.info(`Time taken: ${(stats.duration / 1000).toFixed(1)}s`)
  if (stats.errors > 0) {
    logger.info(`Errors encountered: ${stats.errors}`)
  }
  logger.info('========================')
  logger.info('')
}

export default logger
