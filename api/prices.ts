import { pricesHandler } from './handlers/prices';

export default async function handler(req: Request): Promise<Response> {
  const result = await pricesHandler(req.method);
  const headers = new Headers(result.headers || {});
  headers.set('Content-Type', 'application/json');
  
  return new Response(JSON.stringify(result.body), { 
    status: result.status,
    headers 
  });
}