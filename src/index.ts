import express from 'express';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import * as fs from 'fs';
import * as path from 'path';
import { initializeStorage, StorageType } from './storage';
import priceRoutes from './api/routes';
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

// Remove duplicate /health endpoint since we have /healthcheck in routes

app.get('/', (_req, res) => {
  res.json({ 
    message: 'Yearn Pricing Service',
    version: '1.0.0',
    endpoints: [
      'GET /prices - returns all prices',
      'GET /prices/:chainId - returns all prices for that chain',
      'GET /prices/:tokens - returns prices for specific tokens (format: chainId:address,chainId:address)',
      'GET /healthcheck - returns service health status'
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
    const storageType = (process.env.STORAGE_TYPE || 'file') as StorageType;
    const backupDir = './data/prices';
    
    initializeStorage(storageType, cacheTTL, backupDir);
    
    logger.info(`Price storage initialized with ${storageType} backend`);
    logger.info(`Cache TTL: ${cacheTTL} seconds`);
    
    // Running in static mode - serving cached data from disk
    logger.info('🔒 Running in static mode - serving cached prices from disk');
    logger.info('💡 To refresh prices, run: bun run refresh');
    
    // Show last update time from data files
    try {
      const dataDir = path.join(process.cwd(), 'data/prices');
      
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
          const stats = files.map(f => fs.statSync(path.join(dataDir, f)));
          const mostRecent = Math.max(...stats.map(s => s.mtime.getTime()));
          const lastUpdate = new Date(mostRecent);
          logger.info(`📅 Last price update: ${lastUpdate.toLocaleString()}`);
        }
      }
    } catch (err) {
      // Ignore errors in getting last update time
    }
    
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
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down gracefully...');
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