import { healthcheckHandler } from './handlers/healthcheck';

export default async function handler(req: Request): Promise<Response> {
  const result = await healthcheckHandler(req.method);
  return Response.json(result.body, { status: result.status });
}