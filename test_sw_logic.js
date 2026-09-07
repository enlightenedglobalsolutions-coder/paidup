/* test_sw_logic.js — node test_sw_logic.js. Copyright (c) 2026 EGS. */
'use strict';
var L = require('./sw_logic.js');
var pass = 0, fail = 0;
function t(name, cond){ if(cond){ pass++; } else { fail++; console.log('FAIL: ' + name); } }

t('cache name shape', L.cacheName('paidup','2026.08.05-0001') === 'egs-paidup-2026.08.05-0001');
t('own old cache is stale', L.isOwnOldCache('egs-paidup-2026.01.01-0000','paidup','egs-paidup-2026.08.05-0001'));
t('current cache is not stale', !L.isOwnOldCache('egs-paidup-2026.08.05-0001','paidup','egs-paidup-2026.08.05-0001'));
t('sibling app cache never touched', !L.isOwnOldCache('egs-notebuilt-2026.01.01-0000','paidup','egs-paidup-x'));
t('sibling with paidup-ish prefix never touched', !L.isOwnOldCache('egs-paidup2-2026.01.01','paidup','egs-paidup-x'));
t('non-egs cache never touched', !L.isOwnOldCache('workbox-v1','paidup','egs-paidup-x'));

t('navigate mode is navigation', L.isNavigationRequest('navigate','', ''));
t('document destination is navigation', L.isNavigationRequest('no-cors','document',''));
t('html accept header is navigation', L.isNavigationRequest('cors','', 'text/html,application/xhtml+xml'));
t('image is not navigation', !L.isNavigationRequest('no-cors','image','image/png'));
t('script is not navigation', !L.isNavigationRequest('cors','script','*/*'));

t('same-origin GET handled', L.shouldHandle('GET','https://a.io','https://a.io'));
t('POST never handled', !L.shouldHandle('POST','https://a.io','https://a.io'));
t('cross-origin never handled', !L.shouldHandle('GET','https://cdn.example','https://a.io'));
t('timeout is 3-4s band', L.NETWORK_TIMEOUT_MS >= 3000 && L.NETWORK_TIMEOUT_MS <= 4000);

/* ---- raceAbort: PaidUp's counterpart to the skeleton's raceTimeout ----
   Fake timers so this stays instant and deterministic — nothing here waits
   on a real clock. Mirrors platform/test_sw_logic.js's structure so the same
   class of bug gets the same kind of proof on both implementations. */
function fakeTimers(){
  var q=[], n=0;
  return { set:function(fn,ms){ n++; q.push({id:n,fn:fn}); return n; },
           clear:function(id){ q=q.filter(function(x){ return x.id!==id; }); },
           fire:function(){ var due=q; q=[]; due.forEach(function(x){ x.fn(); }); },
           pending:function(){ return q.length; } };
}
var hang = function(){ return new Promise(function(){}); };   // never settles

// A suite that awaits a promise which never settles doesn't fail — the event
// loop just drains and node exits 0. Both guards below exist so a hang can
// never read as a pass (same lesson platform/test_sw_logic.js learned).
var WATCHDOG = setTimeout(function(){
  console.log('FAIL: suite did not finish — a promise never settled');
  process.exit(1);
}, 5000);
function within(pr){
  return Promise.race([pr, new Promise(function(r){ setTimeout(function(){ r('__NEVER_SETTLED__'); }, 1000); })]);
}

(function(){
  return Promise.resolve().then(async function(){
    // 1. healthy network wins; fallback never consulted; nothing aborted
    var T = fakeTimers(), usedFallback = false, aborted = false;
    var r = await L.raceAbort(function(signal){
      signal.addEventListener('abort', function(){ aborted = true; });
      return Promise.resolve('NET');
    }, 3500, function(){ usedFallback = true; return 'CACHE'; }, T);
    t('fast network wins the race', r === 'NET');
    t('fallback not consulted when network wins', !usedFallback);
    t('signal not aborted when network wins', !aborted);
    t('timer cleared when network wins', T.pending() === 0);

    // 2. THE BUG this exists for: a hung network must not hang the app —
    // AND must be genuinely cancelled, not just ignored (raceAbort's whole
    // reason to differ from the skeleton's raceTimeout).
    T = fakeTimers();
    var sig;
    var pending = L.raceAbort(function(signal){ sig = signal; return hang(); }, 3500, function(){ return 'CACHE'; }, T);
    t('timer armed while the network hangs', T.pending() === 1);
    T.fire();
    var got = await within(pending);
    t('hanging network falls back to cache', got === 'CACHE');
    t('the hung fetch is actually aborted, not left dangling', !!sig && sig.aborted === true);

    // 3. a rejecting network (true offline) still falls back — old behaviour kept
    T = fakeTimers();
    r = await L.raceAbort(function(){ return Promise.reject(new Error('offline')); }, 3500, function(){ return 'CACHE'; }, T);
    t('rejected network falls back to cache', r === 'CACHE');
    t('timer cleared on rejection too', T.pending() === 0);

    // 4. SW_TIMER_RECEIVER — the regression that broke Notebuilt's navigations
    // at 2026.08.12-1407. Browsers enforce a Web IDL receiver on setTimeout;
    // node does not, so this simulates it. Without this shim node cannot see
    // the bug class at all — it only ever manifests on device.
    var realSetTimeout = global.setTimeout;
    global.setTimeout = function(fn, ms){
      if (this !== global && this !== undefined && this !== globalThis){
        throw new TypeError('Illegal invocation');
      }
      return realSetTimeout(fn, ms);
    };
    var receiverOk = false, receiverErr = null;
    try {
      receiverOk = (await L.raceAbort(function(){ return Promise.resolve('NET'); }, 3500, function(){ return 'CACHE'; })) === 'NET';
    } catch (e) { receiverErr = e.name + ': ' + e.message; }
    var hangOk = false;
    try {
      hangOk = (await L.raceAbort(function(){ return hang(); }, 20, function(){ return 'CACHE'; })) === 'CACHE';
    } catch (e) { receiverErr = receiverErr || (e.name + ': ' + e.message); }
    global.setTimeout = realSetTimeout;
    t('default timers survive a Web IDL receiver check (fast path)', receiverOk);
    t('default timers survive a Web IDL receiver check (deadline path)', hangOk);

    clearTimeout(WATCHDOG);
    console.log(pass + '/' + (pass+fail) + ' sw_logic tests pass');
    process.exit(fail ? 1 : 0);
  });
})();
