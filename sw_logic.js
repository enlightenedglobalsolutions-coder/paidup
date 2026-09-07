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

   SANCTIONED VARIANT, not drift (th_sw_logic_fork, 2026-09-07) — this file is
   an independent implementation of the same platform/sw_logic.js contract,
   not a copy that fell out of sync. Differences, on purpose:
     - Export/name shape: EGS_SW_LOGIC / isOwnOldCache / NETWORK_TIMEOUT_MS
       here vs EGS_SW / staleCaches / NET_TIMEOUT_MS on the skeleton. This is
       exactly what made egs-deploy.sh's stamp step silently no-op on PaidUp
       (var VERSION vs const CACHE_VERSION) — the script now accepts both
       shapes, but don't rename one side and assume the other still matches.
     - Non-HTML strategy is cache-first, not stale-while-revalidate — PaidUp's
       asset set (icons, manifest) changes rarely enough that this is a
       deliberate simplicity trade, not an oversight.
     - No raceTimeout. PaidUp actually CANCELS the hung fetch via
       AbortController (see raceAbort below) instead of letting the network
       promise dangle after the deadline — real cancellation, not just being
       ignored. It reuses the skeleton's exact SW_TIMER_RECEIVER defense
       (injectable timers, see raceAbort's comment) since that lesson applies
       to any setTimeout/clearTimeout in a service worker, regardless of
       which file it lives in.
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

  /* raceAbort — PaidUp's counterpart to the skeleton's raceTimeout
     (platform/sw_logic.js). Same deadline idea, but on timeout it actually
     aborts the in-flight fetch via AbortController rather than leaving the
     network promise to resolve into the void later.

     SW_TIMER_RECEIVER — same defense as the skeleton, because the bug is in
     setTimeout/clearTimeout, not in raceTimeout's particular shape: `timers`
     MUST be wrapper functions, never bare references pulled off some other
     object. `{set:setTimeout}` then `T.set(fn,ms)` calls setTimeout with
     `this === T` instead of the global, and browsers' Web IDL answers that
     with "TypeError: Illegal invocation" — invisible in node (Node's
     setTimeout ignores `this`), fatal on device. That exact shape is what
     broke every navigation on Notebuilt at 2026.08.12-1407. PaidUp's
     AbortController path didn't have this bug (setTimeout/clearTimeout were
     always called as bare globals, never through an object method), but it
     also had zero test coverage before this function existed to hold it —
     this closes that gap the same way the skeleton closed it.

     networkFn(signal) is called immediately and must return a promise. */
  function raceAbort(networkFn, ms, fallbackFn, timers){
    var T = timers || { set:function(fn,ms){ return setTimeout(fn,ms); },
                        clear:function(id){ return clearTimeout(id); } };
    var ctrl = new AbortController();
    return new Promise(function(resolve){
      var settled = false;
      var id = T.set(function(){
        if(settled) return; settled = true;
        ctrl.abort();
        resolve(fallbackFn());
      }, ms);
      networkFn(ctrl.signal).then(function(res){
        if(settled) return; settled = true; T.clear(id); resolve(res);
      }, function(){
        if(settled) return; settled = true; T.clear(id); resolve(fallbackFn());
      });
    });
  }

  var api = {
    NETWORK_TIMEOUT_MS: NETWORK_TIMEOUT_MS,
    cacheName: cacheName,
    isOwnOldCache: isOwnOldCache,
    isNavigationRequest: isNavigationRequest,
    shouldHandle: shouldHandle,
    raceAbort: raceAbort
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EGS_SW_LOGIC = api;
})(typeof self !== 'undefined' ? self : this);
