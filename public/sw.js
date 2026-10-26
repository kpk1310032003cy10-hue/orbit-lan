// Only the public application shell is cached. Conversations, file contents and
// credentials always go directly to the computer and never enter Cache Storage.
const CACHE = 'orbit-shell-v7';
const SHELL = [
  '/',
  '/app.js',
  '/chat.js',
  '/chat.css',
  '/markdown.js',
  '/vendor/markdown-it.js',
  '/vendor/highlight.js',
  '/vendor/highlight/bash.js',
  '/vendor/highlight/css.js',
  '/vendor/highlight/diff.js',
  '/vendor/highlight/javascript.js',
  '/vendor/highlight/json.js',
  '/vendor/highlight/markdown.js',
  '/vendor/highlight/powershell.js',
  '/vendor/highlight/python.js',
  '/vendor/highlight/sql.js',
  '/vendor/highlight/typescript.js',
  '/vendor/highlight/xml.js',
  '/vendor/highlight/yaml.js',

  '/theme.js',
  '/style.css',
  '/limits.js',
  '/limits.css',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !SHELL.includes(u.pathname))
    return;
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(e.request)),
  );
});
