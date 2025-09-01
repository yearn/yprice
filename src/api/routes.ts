import { Router, Request, Response } from 'express';
import { getPriceStorage } from '../storage';
import { SUPPORTED_CHAINS } from '../models';
import logger from '../utils/logger';

const router = Router();

// GET /prices - returns all prices (original dict format)
router.get('/prices', (_req: Request, res: Response): void => {
  try {
    const allPrices = getPriceStorage().getAllPrices();
    const response: any = {};
    
    allPrices.forEach((chainPrices, chainId) => {
      const chainDict: any = {};
      
      chainPrices.forEach((price, address) => {
        chainDict[address.toLowerCase()] = price.price.toString();
      });
      
      response[chainId.toString()] = chainDict;
    });
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching all prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /prices/[chainId] - returns all prices for that chain
router.get('/prices/:chainId', (req: Request, res: Response): void => {
  try {
    const chainId = parseInt(req.params.chainId);
    
    // Validate chain ID
    if (!chainId || !Object.values(SUPPORTED_CHAINS).some(c => c.id === chainId)) {
      res.status(400).json({ error: 'Invalid chain ID' });
      return;
    }
    
    const { asMap } = getPriceStorage().listPrices(chainId);
    const response: any = {};
    
    asMap.forEach((price, address) => {
      response[address.toLowerCase()] = price.price.toString();
    });
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching chain prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /prices/[chainId:address,chainId:address,...] - returns prices for specified tokens
router.get('/prices/:tokens', (req: Request, res: Response): void => {
  try {
    const tokens = req.params.tokens;
    
    // Check if this is actually a single chainId (numeric)
    if (!isNaN(Number(tokens))) {
      // This is handled by the previous route
      return;
    }
    
    const storage = getPriceStorage();
    const response: any = {};
    
    // Parse token list: "1:0xabc,10:0xdef,137:0x123"
    const tokenList = tokens.split(',');
    
    tokenList.forEach(token => {
      const [chainIdStr, address] = token.split(':');
      const chainId = parseInt(chainIdStr);
      
      if (chainId && address) {
        const price = storage.getPrice(chainId, address);
        if (price) {
          // Use the full chainId:address as the key
          response[`${chainId}:${address.toLowerCase()}`] = price.price.toString();
        }
      }
    });
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching token prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /healthcheck - returns timestamp
router.get('/healthcheck', (_req: Request, res: Response): void => {
  res.json({
    healthcheck: Date.now(),
    status: 'ok',
    service: 'yearn-pricing'
  });
});

export default router;