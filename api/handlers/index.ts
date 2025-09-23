export async function indexHandler(method: string | undefined) {
  if (method !== 'GET') {
    return {
      status: 405,
      body: { error: 'Method not allowed' }
    };
  }

  return {
    status: 200,
    body: { 
      message: 'Yearn Pricing Service',
      version: '1.0.0',
      endpoints: [
        'GET /api/prices - returns all prices',
        'GET /api/prices/chain/[chainId] - returns all prices for that chain',
        'GET /api/prices/tokens/[list] - returns prices for specific tokens (format: chainId:address,chainId:address)',
        'GET /api/healthcheck - returns service health status'
      ]
    }
  };
}