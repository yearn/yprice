import winston from 'winston'

const logLevel = process.env.LOG_LEVEL || 'info'
const silentMode = process.env.SILENT_MODE === 'true'

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

export default logger
