import https from 'node:https'

export const createHttpsAgent = (): https.Agent => new https.Agent({ rejectUnauthorized: false })
