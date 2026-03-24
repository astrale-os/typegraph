import type { Plugin } from 'vite'

import { handleApiRequest } from './api-routes'

export function falkordbPlugin(): Plugin {
  return {
    name: 'falkordb-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const handled = await handleApiRequest(req, res)
        if (!handled) next()
      })
    },
  }
}
