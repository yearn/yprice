import { logger } from './logger';

// Suppress verbose logs during batch operations
let batchMode = false;
let suppressedLogs = 0;

// Check if verbose logging is disabled via env var
const VERBOSE_DISABLED = process.env.DISABLE_VERBOSE_LOGS === 'true';

export const setBatchMode = (enabled: boolean) => {
  if (!enabled && suppressedLogs > 0) {
    logger.debug(`[Suppressed ${suppressedLogs} verbose logs during batch operation]`);
    suppressedLogs = 0;
  }
  batchMode = enabled;
};

export const logVerbose = (message: string, ...args: any[]) => {
  if (VERBOSE_DISABLED || batchMode) {
    suppressedLogs++;
    return;
  }
  logger.debug(message, ...args);
};

export const logImportant = (message: string, ...args: any[]) => {
  logger.info(message, ...args);
};

export const logWarning = (message: string, ...args: any[]) => {
  logger.warn(message, ...args);
};

export const logError = (message: string, ...args: any[]) => {
  logger.error(message, ...args);
};

// Chain-specific logging with clean formatting
export const logChainInfo = (chainId: number, message: string, icon = '📊') => {
  logger.info(`${icon} Chain ${chainId}: ${message}`);
};

export const logChainComplete = (chainId: number, tokensFound: number, pricesFound: number, duration: number) => {
  const successRate = tokensFound > 0 ? Math.round((pricesFound / tokensFound) * 100) : 0;
  logger.info(
    `✅ Chain ${chainId}: ${pricesFound}/${tokensFound} prices (${successRate}%) in ${(duration / 1000).toFixed(1)}s`
  );
};

// Summary logging
export const logPricingSummary = (stats: {
  totalChains: number;
  totalTokens: number;
  totalPrices: number;
  duration: number;
  errors: number;
}) => {
  const successRate = stats.totalTokens > 0 ? Math.round((stats.totalPrices / stats.totalTokens) * 100) : 0;
  
  logger.info('');
  logger.info('=== 💰 PRICING SUMMARY ===');
  logger.info(`Chains processed: ${stats.totalChains}`);
  logger.info(`Total tokens: ${stats.totalTokens}`);
  logger.info(`Prices found: ${stats.totalPrices} (${successRate}%)`);
  logger.info(`Time taken: ${(stats.duration / 1000).toFixed(1)}s`);
  if (stats.errors > 0) {
    logger.info(`Errors encountered: ${stats.errors}`);
  }
  logger.info('========================');
  logger.info('');
};

// Progress-specific logging
export const logProgress = (phase: string, current: number, total: number, details?: string) => {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar = createProgressBar(percent, 15);
  const detailsStr = details ? ` - ${details}` : '';
  
  // Use carriage return to update in place
  process.stdout.write(`\r${phase}: ${bar} ${current}/${total} (${percent}%)${detailsStr}`);
  
  if (current === total) {
    process.stdout.write('\n'); // New line when complete
  }
};

function createProgressBar(percent: number, width = 20): string {
  const filled = Math.round((percent / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// Export a cleaner logger interface
export const betterLogger = {
  verbose: logVerbose,
  info: logImportant,
  warn: logWarning,
  error: logError,
  chainInfo: logChainInfo,
  chainComplete: logChainComplete,
  summary: logPricingSummary,
  progress: logProgress,
  setBatchMode,
};

// Create a wrapper that can replace the standard logger
export const createSuppressibleLogger = () => {
  return {
    debug: (message: string, ...args: any[]) => logVerbose(message, ...args),
    info: (message: string, ...args: any[]) => logger.info(message, ...args),
    warn: (message: string, ...args: any[]) => logger.warn(message, ...args),
    error: (message: string, ...args: any[]) => logger.error(message, ...args),
  };
};