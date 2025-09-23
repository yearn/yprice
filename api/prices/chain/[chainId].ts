import { pricesChainHandler } from '../../handlers/prices-chain';

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const chainId = url.pathname.split('/').pop();
  
  const result = await pricesChainHandler(req.method, chainId);
  const headers = new Headers(result.headers || {});
  headers.set('Content-Type', 'application/json');
  
  return new Response(JSON.stringify(result.body), { 
    status: result.status,
    headers 
  });
}