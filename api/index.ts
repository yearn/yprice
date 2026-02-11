import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  res.status(200).json({ 
    message: 'Yearn Pricing Service',
    version: '1.0.0',
    endpoints: [
      'GET /api/prices - returns all prices',
      'GET /api/prices/chain/[chainId] - returns all prices for that chain',
      'GET /api/prices/tokens/[list] - returns prices for specific tokens (format: chainId:address,chainId:address)',
      'GET /api/healthcheck - returns service health status'
    ]
  });
}