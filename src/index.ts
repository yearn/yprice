import express from 'express';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { initializePriceStorage } from './storage';
import priceRoutes from './api/routes';
import priceService from './services/priceService';
import { logger } from './utils';
import { SUPPORTED_CHAINS } from './models';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.'
});

app.use('/api', limiter);

app.get('/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    chains: Object.keys(SUPPORTED_CHAINS).length
  });
});

app.get('/', (_req, res) => {
  res.json({ 
    message: 'Yearn Pricing Service',
    version: '1.0.0',
    endpoints: [
      'GET /prices/all',
      'GET /prices/:chainID',
      'GET /prices/:chainID/all',
      'GET /prices/:chainID/all/details',
      'GET /prices/:chainID/:address',
      'GET /prices/:chainID/some/:addresses',
      'GET /prices/some/:addresses',
      'POST /prices/some'
    ]
  });
});

app.use('/', priceRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  try {
    // Use 0 for no expiration (like ydaemon) - prices never expire, just get updated
    const cacheTTL = parseInt(process.env.CACHE_TTL_SECONDS || '0');
    initializePriceStorage(cacheTTL);
    
    logger.info('Price storage initialized');
    logger.info(`Cache TTL: ${cacheTTL} seconds`);
    
    // Start periodic price fetching
    // Default to 5 minutes (300000ms) to allow time for all chains to be processed
    const fetchInterval = parseInt(process.env.FETCH_INTERVAL_MS || '300000');
    priceService.startPeriodicFetch(fetchInterval);
    
    app.listen(PORT, () => {
      logger.info(`Yearn Pricing Service running on port ${PORT}`);
      logger.info(`Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(', ')}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  priceService.stopPeriodicFetch();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down gracefully...');
  priceService.stopPeriodicFetch();
  process.exit(0);
});

startServer();

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});