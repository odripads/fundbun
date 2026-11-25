import { PluginsClient } from '../../src/core/plugins/client'

/** A plugin client that sends Origin like FundBun's own page does (the server refuses changes without one). */
export function browserLikeClient(origin: string): PluginsClient {
  return new PluginsClient(`${origin}/api`, (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('Origin', origin)
    return fetch(input, { ...init, headers })
  })
}
