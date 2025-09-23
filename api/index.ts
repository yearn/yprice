import { indexHandler } from './handlers/index';

export default async function handler(req: Request): Promise<Response> {
  const result = await indexHandler(req.method);
  return Response.json(result.body, { status: result.status });
}