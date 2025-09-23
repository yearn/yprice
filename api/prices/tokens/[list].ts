import { pricesTokensHandler } from '../../handlers/prices-tokens';

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const list = url.pathname.split('/').pop();
  
  const result = await pricesTokensHandler(req.method, list);
  const headers = new Headers(result.headers || {});
  headers.set('Content-Type', 'application/json');
  
  return new Response(JSON.stringify(result.body), { 
    status: result.status,
    headers 
  });
}