export async function healthcheckHandler(method: string | undefined) {
  if (method !== 'GET') {
    return {
      status: 405,
      body: { error: 'Method not allowed' }
    };
  }

  return {
    status: 200,
    body: {
      healthcheck: Date.now(),
      status: 'ok',
      service: 'yearn-pricing'
    }
  };
}