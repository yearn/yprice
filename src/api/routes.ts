import { Router, Request, Response } from 'express';
import { getPriceStorage } from '../storage';
import { SUPPORTED_CHAINS, PriceMapResponse, ChainPricesResponse } from '../models';
import { stringToBool, safeString, humanizePrice, toChecksumAddress } from '../utils';
import logger from '../utils/logger';
import priceService from '../services/priceService';

const router = Router();

function formatPriceResponse(price: any, humanized: boolean, detailed: boolean = false): any {
  if (humanized && price.humanizedPrice === undefined) {
    price.humanizedPrice = humanizePrice(BigInt(price.price));
  }
  
  // For detailed responses, return full object
  if (detailed) {
    return {
      address: toChecksumAddress(price.address),
      price: humanized ? undefined : price.price.toString(),
      humanizedPrice: humanized ? price.humanizedPrice : undefined,
      source: price.source
    };
  }
  
  // For simple responses (matching ydaemon), return just the price string
  return humanized ? price.humanizedPrice : price.price.toString();
}

router.get('/prices/all', (req: Request, res: Response): Response | void => {
  try {
    const humanized = stringToBool(safeString(req.query.humanized as string | undefined, 'false'));
    const detailed = stringToBool(safeString(req.query.detailed as string | undefined, 'false'));
    const storage = getPriceStorage();
    const allPrices = storage.getAllPrices();
    
    const response: ChainPricesResponse = {};
    
    allPrices.forEach((chainPrices, chainId) => {
      const chainResponse: any = {};
      
      chainPrices.forEach((price, address) => {
        // Use checksummed address as key
        const checksummedAddress = toChecksumAddress(address);
        chainResponse[checksummedAddress] = formatPriceResponse(price, humanized, detailed);
      });
      
      response[chainId.toString()] = chainResponse;
    });
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching all prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/prices/:chainID', (req: Request, res: Response): Response | void => {
  try {
    const chainId = parseInt(req.params.chainID!);
    if (!chainId || !Object.values(SUPPORTED_CHAINS).find(c => c.id === chainId)) {
      return res.status(400).json({ error: 'Invalid chain ID' });
    }
    
    const humanized = stringToBool(safeString(req.query.humanized as string | undefined, 'false'));
    const storage = getPriceStorage();
    const { asMap } = storage.listPrices(chainId);
    
    const response: PriceMapResponse = {};
    
    asMap.forEach((price, address) => {
      response[address] = formatPriceResponse(price, humanized);
    });
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching chain prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/prices/:chainID/all', (req: Request, res: Response): Response | void => {
  try {
    const chainId = parseInt(req.params.chainID!);
    if (!chainId || !Object.values(SUPPORTED_CHAINS).find(c => c.id === chainId)) {
      return res.status(400).json({ error: 'Invalid chain ID' });
    }
    
    const humanized = stringToBool(safeString(req.query.humanized as string | undefined, 'false'));
    const storage = getPriceStorage();
    const { asSlice } = storage.listPrices(chainId);
    
    const response = asSlice.map(price => formatPriceResponse(price, humanized));
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching chain prices details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/prices/:chainID/all/details', (req: Request, res: Response): Response | void => {
  try {
    const chainId = parseInt(req.params.chainID!);
    if (!chainId || !Object.values(SUPPORTED_CHAINS).find(c => c.id === chainId)) {
      return res.status(400).json({ error: 'Invalid chain ID' });
    }
    
    const humanized = stringToBool(safeString(req.query.humanized as string | undefined, 'false'));
    const storage = getPriceStorage();
    const { asSlice } = storage.listPrices(chainId);
    
    const response = asSlice.map(price => ({
      ...formatPriceResponse(price, humanized),
      chainId,
      timestamp: Date.now()
    }));
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching chain prices details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/prices/:chainID/:address', (req: Request, res: Response): Response | void => {
  try {
    const chainId = parseInt(req.params.chainID!);
    if (!chainId || !Object.values(SUPPORTED_CHAINS).find(c => c.id === chainId)) {
      return res.status(400).json({ error: 'Invalid chain ID' });
    }
    
    const address = req.params.address!;
    const humanized = stringToBool(safeString(req.query.humanized as string | undefined, 'false'));
    const storage = getPriceStorage();
    const price = storage.getPrice(chainId, address);
    
    if (!price) {
      return res.status(404).json({ error: 'Price not found' });
    }
    
    res.json(formatPriceResponse(price, humanized));
  } catch (error) {
    logger.error('Error fetching single price:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/prices/:chainID/some/:addresses', (req: Request, res: Response): Response | void => {
  try {
    const chainId = parseInt(req.params.chainID!);
    if (!chainId || !Object.values(SUPPORTED_CHAINS).find(c => c.id === chainId)) {
      return res.status(400).json({ error: 'Invalid chain ID' });
    }
    
    const addresses = req.params.addresses!.split(',');
    const humanized = stringToBool(safeString(req.query.humanized as string | undefined, 'false'));
    const storage = getPriceStorage();
    
    const response: PriceMapResponse = {};
    
    addresses.forEach(address => {
      const price = storage.getPrice(chainId, address);
      if (price) {
        response[address] = formatPriceResponse(price, humanized);
      }
    });
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching some prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/prices/some/:addresses', (req: Request, res: Response): Response | void => {
  try {
    const addresses = req.params.addresses!.split(',');
    const humanized = stringToBool(safeString(req.query.humanized as string | undefined, 'false'));
    const storage = getPriceStorage();
    
    const response: ChainPricesResponse = {};
    
    Object.values(SUPPORTED_CHAINS).forEach(chain => {
      const chainResponse: PriceMapResponse = {};
      
      addresses.forEach(address => {
        const price = storage.getPrice(chain.id, address);
        if (price) {
          chainResponse[address] = formatPriceResponse(price, humanized);
        }
      });
      
      if (Object.keys(chainResponse).length > 0) {
        response[chain.id.toString()] = chainResponse;
      }
    });
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching cross-chain prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/prices/some', (req: Request, res: Response): Response | void => {
  try {
    const { addresses, chainIds } = req.body;
    
    if (!Array.isArray(addresses)) {
      return res.status(400).json({ error: 'addresses must be an array' });
    }
    
    const humanized = stringToBool(safeString(req.query.humanized as string | undefined, 'false'));
    const storage = getPriceStorage();
    
    const response: ChainPricesResponse = {};
    const chains = chainIds && Array.isArray(chainIds) 
      ? chainIds.map(id => ({ id }))
      : Object.values(SUPPORTED_CHAINS);
    
    chains.forEach((chain: any) => {
      const chainResponse: PriceMapResponse = {};
      
      addresses.forEach((address: string) => {
        const price = storage.getPrice(chain.id, address);
        if (price) {
          chainResponse[address] = formatPriceResponse(price, humanized);
        }
      });
      
      if (Object.keys(chainResponse).length > 0) {
        response[chain.id.toString()] = chainResponse;
      }
    });
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching batch prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin endpoint to trigger price refresh
router.post('/admin/refresh-prices', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const forceRediscover = req.body?.rediscover === true;
    logger.info(`Manual price refresh triggered (rediscover: ${forceRediscover})`);
    await priceService.fetchDiscoveredTokens(forceRediscover);
    res.json({ 
      message: 'Price refresh initiated', 
      success: true,
      rediscovered: forceRediscover 
    });
  } catch (error) {
    logger.error('Error refreshing prices:', error);
    res.status(500).json({ error: 'Failed to refresh prices' });
  }
});

// Admin endpoint to view token discovery stats
router.get('/admin/tokens/stats', (_req: Request, res: Response): Response | void => {
  try {
    const tokenDiscoveryService = require('../discovery/tokenDiscoveryService').default;
    const chainCounts = tokenDiscoveryService.getChainTokenCounts();
    const total = tokenDiscoveryService.getTotalTokenCount();
    
    res.json({
      total,
      byChain: chainCounts,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting token stats:', error);
    res.status(500).json({ error: 'Failed to get token stats' });
  }
});

export default router;