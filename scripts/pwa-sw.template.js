const CACHE_NAME = '__FUNDBUN_CACHE_NAME__'
const PRECACHE = __FUNDBUN_PRECACHE__
const CACHE_PREFIX = 'fundbun-'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const requests = PRECACHE.map((path) => new Request(new URL(path, self.registration.scope), { cache: 'reload' }))
      return cache.addAll(requests)
    }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  const scope = new URL(self.registration.scope)
  if (url.origin !== scope.origin || !url.href.startsWith(scope.href)) return
  if (url.pathname.startsWith(new URL('api/', scope).pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        return (await caches.match(request, { ignoreVary: true })) || (await caches.match(new URL('index.html', scope).toString(), { ignoreVary: true })) || Response.error()
      }),
    )
    return
  }

  event.respondWith(caches.match(request, { ignoreVary: true }).then((cached) => cached || fetch(request)))
})
