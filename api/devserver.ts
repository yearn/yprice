import { serve } from 'bun';
import { indexHandler } from './handlers/index';
import { healthcheckHandler } from './handlers/healthcheck';
import { pricesHandler } from './handlers/prices';
import { pricesChainHandler } from './handlers/prices-chain';
import { pricesTokensHandler } from './handlers/prices-tokens';

serve({
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    // Root endpoint
    if (url.pathname === '/api/' || url.pathname === '/api') {
      const result = await indexHandler(method);
      return Response.json(result.body, { status: result.status });
    }

    // Healthcheck endpoint
    if (url.pathname === '/api/healthcheck') {
      const result = await healthcheckHandler(method);
      return Response.json(result.body, { status: result.status });
    }

    // All prices endpoint (both /api/prices and /api/prices/all)
    if (url.pathname === '/api/prices' || url.pathname === '/api/prices/all') {
      const result = await pricesHandler(method);
      const headers = new Headers(result.headers || {});
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(result.body), { 
        status: result.status,
        headers 
      });
    }

    // Chain-specific prices endpoint (two patterns)
    const chainMatch = url.pathname.match(/^\/api\/prices\/chain\/(\d+)$/);
    const chainAllMatch = url.pathname.match(/^\/api\/(\d+)\/prices\/all$/);
    
    if (chainMatch || chainAllMatch) {
      const chainId = chainMatch?.[1] || chainAllMatch?.[1];
      const result = await pricesChainHandler(method, chainId);
      const headers = new Headers(result.headers || {});
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(result.body), { 
        status: result.status,
        headers 
      });
    }

    // Token-specific prices endpoint
    const tokensMatch = url.pathname.match(/^\/api\/prices\/tokens\/(.+)$/);
    if (tokensMatch) {
      const list = tokensMatch[1];
      const result = await pricesTokensHandler(method, list);
      const headers = new Headers(result.headers || {});
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(result.body), { 
        status: result.status,
        headers 
      });
    }

    return new Response('Not found', { status: 404 });
  },
  port: 3001,
});

console.log('🚀 API server running on http://localhost:3001');