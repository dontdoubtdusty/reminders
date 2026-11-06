// Offline helper. Always tries the internet first, so new versions you upload show up right away;
// falls back to the last saved copy when there's no connection. Your budget data is never touched here.
const CACHE='big-juicy-v1';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  // Sync traffic (Firebase sign-in and database, on googleapis.com) goes straight to the network, never the cache
  const r=e.request,h=new URL(r.url).hostname;if(r.method!=='GET'||(h.endsWith('googleapis.com')&&h!=='fonts.googleapis.com'))return;
  e.respondWith(fetch(r).then(res=>{if(res.ok){const c=res.clone();caches.open(CACHE).then(k=>k.put(r,c))}return res})
    .catch(()=>caches.match(r).then(m=>m||(r.mode==='navigate'?caches.match('./'):undefined))));
});

// Push notifications (sent by the notify-functions Cloud Function through Firebase Cloud Messaging)
self.addEventListener('push',e=>{
  let p={};try{p=e.data?e.data.json():{}}catch(x){}
  const d=p.data||p.notification||p;
  e.waitUntil(self.registration.showNotification(d.title||'Big Tidy',{body:d.body||'',tag:d.tag||undefined,icon:'icon-192.png',badge:'icon-192.png',data:{url:'./'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{
    for(const c of l){if('focus' in c)return c.focus()}
    return clients.openWindow('./');
  }));
});
