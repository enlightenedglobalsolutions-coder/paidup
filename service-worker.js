/* =============================================================================
   service-worker.js — PaidUp, on the EGS platform skeleton.
   Copyright (c) 2026 Enlightened Global Solutions. All rights reserved.

   APP_NAME is the only line that changes between apps. All caching decisions
   live in sw_logic.js (tested in node); this file just executes them.
   egs-deploy.sh stamps VERSION (and window.EGS_VERSION in index.html).
   ============================================================================= */
importScripts('./sw_logic.js');

var APP_NAME = 'paidup';
var VERSION = '2026.08.06-0002';
var CACHE = EGS_SW_LOGIC.cacheName(APP_NAME, VERSION);

var CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sw_logic.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c){ return c.addAll(CORE); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys
        .filter(function(k){ return EGS_SW_LOGIC.isOwnOldCache(k, APP_NAME, CACHE); })
        .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* Network-first with a hard timeout: fetch races NETWORK_TIMEOUT_MS; whichever
   loses is genuinely cancelled (AbortController), and cache serves the answer.
   True offline rejects instantly, so this only ever costs time on
   connected-but-dead networks — exactly the case it exists for. */
function networkFirstWithTimeout(req){
  var ctrl = new AbortController();
  var timer = setTimeout(function(){ ctrl.abort(); }, EGS_SW_LOGIC.NETWORK_TIMEOUT_MS);
  return fetch(req, { signal: ctrl.signal }).then(function(res){
    clearTimeout(timer);
    if(res && res.ok){
      var copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(req, copy); });
    }
    return res;
  }).catch(function(){
    clearTimeout(timer);
    return caches.match(req).then(function(hit){
      return hit || caches.match('./index.html');
    });
  });
}

function cacheFirst(req){
  return caches.match(req).then(function(hit){
    if(hit) return hit;
    return fetch(req).then(function(res){
      if(res && res.ok){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); });
      }
      return res;
    });
  });
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  var url = new URL(req.url);
  if(!EGS_SW_LOGIC.shouldHandle(req.method, url.origin, self.location.origin)) return;
  if(EGS_SW_LOGIC.isNavigationRequest(req.mode, req.destination, req.headers.get('accept'))){
    e.respondWith(networkFirstWithTimeout(req));
  } else {
    e.respondWith(cacheFirst(req));
  }
});
