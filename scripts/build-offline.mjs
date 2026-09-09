import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = (await readdir('dist/assets')).map((name) => `/assets/${name}`);
const version = createHash('sha256').update(assets.join('')).digest('hex').slice(0, 12);
const shell = ['/', '/favicon.svg', '/manifest.webmanifest', ...assets];
await writeFile(
  'dist/sw.js',
  `const CACHE='figlet-${version}';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(${JSON.stringify(shell)})).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('figlet-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/'))return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put('/',copy));}return r;}).catch(()=>caches.match('/')));}else{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));}});
`,
);
console.log(`Offline shell: ${shell.length} assets`);
