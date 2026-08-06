/* =============================================================================
   sw_logic.js — EGS platform: pure caching decisions, imported by the
   service worker via importScripts and tested standalone in node.
   Copyright (c) 2026 Enlightened Global Solutions. All rights reserved.

   The service worker keeps zero decision logic of its own — every judgment
   call lives here so it can be proven in node (test_sw_logic.js) without a
   browser. Rebuilt to the EGS platform spec for PaidUp, including the
   Aug 5 2026 standard: network-first HTML races a short timeout so a
   connected-but-dead network (captive portal, equipment wifi) falls back to
   cache in ~3.5s instead of hanging on the OS timeout.
   ============================================================================= */
(function(root){
  'use strict';

  /* How long network-first HTML waits before falling back to cache.
     True offline still fails fast (fetch rejects immediately); this guards the
     worst case — wifi that connects but goes nowhere. */
  var NETWORK_TIMEOUT_MS = 3500;

  function cacheName(app, version){
    return 'egs-' + app + '-' + version;
  }

  /* True only for THIS app's stale caches — never touches sibling apps on the
     shared origin. */
  function isOwnOldCache(name, app, currentCache){
    return name.indexOf('egs-' + app + '-') === 0 && name !== currentCache;
  }

  /* HTML navigations go network-first (fresh deploys reach the phone on next
     online launch, no cache clearing). Everything else is cache-first. */
  function isNavigationRequest(mode, destination, acceptHeader){
    if(mode === 'navigate') return true;
    if(destination === 'document') return true;
    return /text\/html/.test(acceptHeader || '');
  }

  /* Only same-origin GETs are ever cached. */
  function shouldHandle(method, requestOrigin, selfOrigin){
    return method === 'GET' && requestOrigin === selfOrigin;
  }

  var api = {
    NETWORK_TIMEOUT_MS: NETWORK_TIMEOUT_MS,
    cacheName: cacheName,
    isOwnOldCache: isOwnOldCache,
    isNavigationRequest: isNavigationRequest,
    shouldHandle: shouldHandle
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EGS_SW_LOGIC = api;
})(typeof self !== 'undefined' ? self : this);
