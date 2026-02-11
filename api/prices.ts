import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getInitializedStorage } from './_lib/storage';
import { logger } from '../dist/utils';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const storage = getInitializedStorage();
    const allPrices = await storage.getAllPrices();
    const response: any = {};

    allPrices.forEach((chainPrices, chainId) => {
      const chainDict: any = {};

      chainPrices.forEach((price, address) => {
        chainDict[address.toLowerCase()] = price.price.toString();
      });

      response[chainId.toString()] = chainDict;
    });

    // Set cache headers for better performance
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(response);
  } catch (error) {
    logger.error('Error fetching all prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
