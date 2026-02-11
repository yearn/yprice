import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getInitializedStorage } from '../../_lib/storage';
import { SUPPORTED_CHAINS } from '../../../dist/models/index';
import { logger } from '../../../dist/utils/index';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const chainId = parseInt(req.query.chainId as string);

    // Validate chain ID
    if (!chainId || !Object.values(SUPPORTED_CHAINS).some((c: any) => c.id === chainId)) {
      res.status(400).json({ error: 'Invalid chain ID' });
      return;
    }

    const storage = getInitializedStorage();
    const { asMap } = await storage.listPrices(chainId);
    const response: any = {};

    asMap.forEach((price, address) => {
      response[address.toLowerCase()] = price.price.toString();
    });

    // Set cache headers for better performance
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(response);
  } catch (error) {
    logger.error('Error fetching chain prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
