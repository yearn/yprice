import winston from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';
const silentMode = process.env.SILENT_MODE === 'true';

// Custom format to reduce noise
const customFormat = winston.format.printf(({ level, message }: any) => {
  // Clean up error messages
  if (level === 'error' && typeof message === 'object' && message.stack) {
    // Extract just the error message, remove stack traces
    const errorMsg = message.message || message.shortMessage || 'Unknown error';
    return `error: ${errorMsg}`;
  }
  
  // Skip verbose logs unless in debug mode
  if (logLevel !== 'debug') {
    // Filter out repetitive messages
    if (message.includes('DeFiLlama returned') || 
        message.includes('CoinGecko returned') ||
        message.includes('Fetching prices for') ||
        message.includes('Stored') ||
        message.includes('from cache') ||
        message.includes('[Velodrome]') ||
        message.includes('DeFiLlama:') ||
        message.includes('CoinGecko:')) {
      return '';
    }
  }
  
  // Use simpler format without timestamp for cleaner output
  return message ? `${message}` : '';
});

export const logger = winston.createLogger({
  level: logLevel,
  silent: silentMode,
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    customFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Helper to temporarily change log level
export function setLogLevel(level: string): void {
  logger.level = level;
}

// Helper to enable/disable silent mode
export function setSilentMode(silent: boolean): void {
  logger.silent = silent;
}

export default logger;