import { Router, Request, Response } from 'express';
import { getPriceStorage } from '../storage';
import { SUPPORTED_CHAINS, PriceMapResponse, ChainPricesResponse } from '../models';
import { stringToBool, humanizePrice, toChecksumAddress } from '../utils';
import logger from '../utils/logger';
import priceService from '../services/priceService';

const router = Router();

const formatPriceResponse = (price: any, humanized: boolean, detailed = false): any => {
  if (humanized && !price.humanizedPrice) {
    price.humanizedPrice = humanizePrice(BigInt(price.price));
  }
  
  if (detailed) {
    return {
      address: toChecksumAddress(price.address),
      price: humanized ? undefined : price.price.toString(),
      humanizedPrice: humanized ? price.humanizedPrice : undefined,
      source: price.source
    };
  }
  
  return humanized ? price.humanizedPrice : price.price.toString();
};

router.get('/prices/all', (req: Request, res: Response): Response | void => {
  try {
    const humanized = stringToBool(req.query.humanized as string);
    const detailed = stringToBool(req.query.detailed as string);
    const allPrices = getPriceStorage().getAllPrices();
    
    const response: any = {};
    
    allPrices.forEach((chainPrices, chainId) => {
      const priceMap = new Map<string, any>();
      const addresses: string[] = [];
      
      chainPrices.forEach((price, address) => {
        const lowerAddress = address.toLowerCase();
        addresses.push(lowerAddress);
        priceMap.set(lowerAddress, formatPriceResponse(price, humanized, detailed));
      });
      
      response[chainId.toString()] = Object.fromEntries(
        addresses.sort().map(addr => [addr, priceMap.get(addr)])
      );
    });
    
    res.json(response);
  } catch (error) {
    handleError(res, 'Error fetching all prices:', error);
  }
});

const validateChainId = (chainId: number) => 
  chainId && Object.values(SUPPORTED_CHAINS).some(c => c.id === chainId);

const handleError = (res: Response, message: string, error?: any) => {
  if (error) logger.error(message, error);
  res.status(500).json({ error: 'Internal server error' });
};

router.get('/prices/:chainID', (req: Request, res: Response): Response | void => {
  try {
    const chainId = parseInt(req.params.chainID!);
    if (!validateChainId(chainId)) {
      return res.status(400).json({ error: 'Invalid chain ID' });
    }
    
    const humanized = stringToBool(req.query.humanized as string);
    const { asMap } = getPriceStorage().listPrices(chainId);
    
    const response: PriceMapResponse = {};
    asMap.forEach((price, address) => {
      response[address] = formatPriceResponse(price, humanized);
    });
    
    res.json(response);
  } catch (error) {
    handleError(res, 'Error fetching chain prices:', error);
  }
});

router.get('/prices/:chainID/all', (req: Request, res: Response): Response | void => {
  try {
    const chainId = parseInt(req.params.chainID!);
    if (!validateChainId(chainId)) {
      return res.status(400).json({ error: 'Invalid chain ID' });
    }
    
    const humanized = stringToBool(req.query.humanized as string);
    const { asSlice } = getPriceStorage().listPrices(chainId);
    
    res.json(asSlice.map(price => formatPriceResponse(price, humanized)));
  } catch (error) {
    handleError(res, 'Error fetching chain prices details:', error);
  }
});

router.get('/prices/:chainID/all/details', (req: Request, res: Response): Response | void => {
  try {
    const chainId = parseInt(req.params.chainID!);
    if (!validateChainId(chainId)) {
      return res.status(400).json({ error: 'Invalid chain ID' });
    }
    
    const humanized = stringToBool(req.query.humanized as string);
    const { asSlice } = getPriceStorage().listPrices(chainId);
    
    res.json(asSlice.map(price => ({
      ...formatPriceResponse(price, humanized),
      chainId,
      timestamp: Date.now()
    })));
  } catch (error) {
    handleError(res, 'Error fetching chain prices details:', error);
  }
});

router.get('/prices/:chainID/:address', (req: Request, res: Response): Response | void => {
  try {
    const chainId = parseInt(req.params.chainID!);
    if (!validateChainId(chainId)) {
      return res.status(400).json({ error: 'Invalid chain ID' });
    }
    
    const price = getPriceStorage().getPrice(chainId, req.params.address!);
    if (!price) {
      return res.status(404).json({ error: 'Price not found' });
    }
    
    res.json(formatPriceResponse(price, stringToBool(req.query.humanized as string)));
  } catch (error) {
    handleError(res, 'Error fetching single price:', error);
  }
});

router.get('/prices/:chainID/some/:addresses', (req: Request, res: Response): Response | void => {
  try {
    const chainId = parseInt(req.params.chainID!);
    if (!validateChainId(chainId)) {
      return res.status(400).json({ error: 'Invalid chain ID' });
    }
    
    const humanized = stringToBool(req.query.humanized as string);
    const storage = getPriceStorage();
    const response: PriceMapResponse = {};
    
    req.params.addresses!.split(',').forEach(address => {
      const price = storage.getPrice(chainId, address);
      if (price) response[address] = formatPriceResponse(price, humanized);
    });
    
    res.json(response);
  } catch (error) {
    handleError(res, 'Error fetching some prices:', error);
  }
});

const buildCrossChainResponse = (addresses: string[], humanized: boolean, chains = Object.values(SUPPORTED_CHAINS)) => {
  const storage = getPriceStorage();
  const response: ChainPricesResponse = {};
  
  chains.forEach(chain => {
    const chainResponse: PriceMapResponse = {};
    
    addresses.forEach(address => {
      const price = storage.getPrice(chain.id, address);
      if (price) chainResponse[address] = formatPriceResponse(price, humanized);
    });
    
    if (Object.keys(chainResponse).length > 0) {
      response[chain.id.toString()] = chainResponse;
    }
  });
  
  return response;
};

router.get('/prices/some/:addresses', (req: Request, res: Response): Response | void => {
  try {
    const addresses = req.params.addresses!.split(',');
    const humanized = stringToBool(req.query.humanized as string);
    
    res.json(buildCrossChainResponse(addresses, humanized));
  } catch (error) {
    handleError(res, 'Error fetching cross-chain prices:', error);
  }
});

router.post('/prices/some', (req: Request, res: Response): Response | void => {
  try {
    const { addresses, chainIds } = req.body;
    
    if (!Array.isArray(addresses)) {
      return res.status(400).json({ error: 'addresses must be an array' });
    }
    
    const humanized = stringToBool(req.query.humanized as string);
    const chains = chainIds && Array.isArray(chainIds) 
      ? Object.values(SUPPORTED_CHAINS).filter(c => chainIds.includes(c.id))
      : Object.values(SUPPORTED_CHAINS);
    
    res.json(buildCrossChainResponse(addresses, humanized, chains));
  } catch (error) {
    handleError(res, 'Error fetching batch prices:', error);
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