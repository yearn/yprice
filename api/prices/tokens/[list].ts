import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getInitializedStorage } from '../../_lib/storage';
import { logger } from '../../../dist/utils/index';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const tokens = req.query.list as string;

    // Check if this is actually a single chainId (numeric)
    if (!isNaN(Number(tokens))) {
      // This should be handled by the [chainId] route
      res.status(400).json({ error: 'Use /prices/[chainId] for chain-specific queries' });
      return;
    }

    const storage = getInitializedStorage();
    const response: any = {};

    // Parse token list: "1:0xabc,10:0xdef,137:0x123"
    const tokenList = tokens.split(',');

    for (const token of tokenList) {
      const [chainIdStr, address] = token.split(':');
      const chainId = parseInt(chainIdStr || '');

      if (chainId && address) {
        const price = await storage.getPrice(chainId, address);
        if (price) {
          // Use the full chainId:address as the key
          response[`${chainId}:${address.toLowerCase()}`] = price.price.toString();
        }
      }
    }

    // Set cache headers for better performance
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(response);
  } catch (error) {
    logger.error('Error fetching token prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
