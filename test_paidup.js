/* ============================================================================
   test_paidup.js — node test_paidup.js. Copyright (c) 2026 EGS.

   REFERENTIAL INTEGRITY (why this file exists)
   v2026.08.05-0001 shipped with every referenced asset under a different name
   than the code asked for: sw_logic.js was on disk as sw_logic-2.js, the icons
   carried -3/-5 download suffixes, and manifest.webmanifest was never copied in
   at all. Nothing failed loudly — the service worker threw on importScripts,
   addAll rejected on the missing CORE entries, and Chrome silently declined to
   fire beforeinstallprompt because there was no manifest. The reported symptom
   was "no install prompt on Android"; the cause was a file-intake slip three
   steps upstream. So the first block here resolves every path the shipping
   source references and asserts the file is actually there.

   INSTALL BANNER
   The Aug-6 standard: the install banner owns the notice slot until it is
   dismissed or the app is installed, and it is NOT gated on beforeinstallprompt
   — that event arrives seconds late, and gating on it let the backup nudge take
   the slot first and suppress the ask permanently.
   ============================================================================ */
'use strict';
var fs = require('fs');
var path = require('path');

var p = 0, f = 0;
function ok(name, cond, extra){
  if(cond){ p++; }
  else { f++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' [' + extra + ']')); }
}

var HERE = __dirname;
/* Read defensively: a MISSING file is precisely the bug this suite exists to
   catch, so it has to report as a failed assertion, not an ENOENT stack trace. */
function readOr(rel){
  try { return fs.readFileSync(path.join(HERE, rel), 'utf8'); }
  catch(e){ return null; }
}
var HTML = readOr('index.html');
var SW   = readOr('service-worker.js');
var MANI = readOr('manifest.webmanifest');

ok('index.html is readable', HTML !== null);
ok('service-worker.js is readable', SW !== null);
ok('manifest.webmanifest is readable', MANI !== null);
if(HTML === null || SW === null || MANI === null){
  console.log('\n' + p + ' passed, ' + f + ' failed');
  process.exit(1);
}

function exists(rel){ return fs.existsSync(path.join(HERE, rel.replace(/^\.\//, ''))); }

/* ---- referential integrity: every path the app names must resolve ---------- */
ok('manifest.webmanifest exists', exists('manifest.webmanifest'));
ok('sw_logic.js exists (not a -2 download suffix)', exists('sw_logic.js'));

/* index.html's own <link>/<script> hrefs */
var htmlRefs = [];
HTML.replace(/(?:href|src)="(\.\/[^"]+)"/g, function(_, r){ htmlRefs.push(r); return _; });
htmlRefs.forEach(function(r){ ok('index.html reference resolves: ' + r, exists(r)); });
ok('index.html references the manifest and both icons', htmlRefs.length >= 3, htmlRefs.length);
/* registered in JS, so it has no href/src attribute to sweep above */
ok('service worker is registered from index.html',
   /navigator\.serviceWorker\.register\('\.\/service-worker\.js'\)/.test(HTML) && exists('service-worker.js'));

/* the service worker's CORE precache list — addAll rejects atomically, so ONE
   bad entry here silently costs the app its entire offline capability */
var core = /var CORE = \[([\s\S]*?)\];/.exec(SW);
ok('CORE precache list found', !!core);
if(core){
  var entries = [];
  core[1].replace(/'([^']+)'/g, function(_, e){ entries.push(e); return _; });
  ok('CORE is non-trivial', entries.length >= 5, entries.length);
  entries.forEach(function(e){
    if(e === './') { ok('CORE entry resolves: ./ (index)', exists('index.html')); }
    else { ok('CORE entry resolves: ' + e, exists(e)); }
  });
}

/* every icon the manifest promises */
var mani = JSON.parse(MANI);
mani.icons.forEach(function(i){ ok('manifest icon resolves: ' + i.src, exists(i.src)); });

/* ---- manifest: the install criteria Chrome actually checks ----------------- */
ok('manifest declares id', mani.id === './', mani.id);
ok('manifest name is PaidUp', mani.name === 'PaidUp');
ok('display is standalone', mani.display === 'standalone');
ok('start_url is relative (Pages subpath safe)', /^\.\//.test(mani.start_url), mani.start_url);
ok('scope is relative (Pages subpath safe)', mani.scope === './', mani.scope);
ok('has a 192px icon', mani.icons.some(function(i){ return i.sizes === '192x192'; }));
ok('has a 512px icon', mani.icons.some(function(i){ return i.sizes === '512x512'; }));
ok('has a maskable icon', mani.icons.some(function(i){ return i.purpose === 'maskable'; }));
ok('index.html links the manifest', /<link rel="manifest" href="\.\/manifest\.webmanifest">/.test(HTML));

/* ---- install banner ------------------------------------------------------- */
ok('listens for beforeinstallprompt', /addEventListener\('beforeinstallprompt'/.test(HTML));
ok("suppresses Chrome's own UI with preventDefault", /e\.preventDefault\(\);/.test(HTML));
ok('keeps the deferred event', /deferredInstall=e;/.test(HTML));
ok('the event re-renders, hot-swapping in the Install button',
   /deferredInstall=e; renderBanners\(\);/.test(HTML));
ok('calls prompt() on the deferred event', /deferredInstall\.prompt\(\);/.test(HTML));
ok('awaits userChoice before clearing', /deferredInstall\.userChoice\.then/.test(HTML));
ok('listens for appinstalled', /addEventListener\('appinstalled'/.test(HTML));
ok('appinstalled stops the banner asking again',
   /addEventListener\('appinstalled',function\(\)\{[^}]*setItem\(K_INSTALL_DISMISS,'1'\)/.test(HTML));

/* the shared-origin trap: workhard-ca.github.io hosts every EGS app, so a bare
   localStorage key would let one app's dismissal silence another's banner */
ok('dismiss key is paidup-prefixed', /K_INSTALL_DISMISS='paidup\.installPromptDismissed'/.test(HTML));
ok('no BARE installPromptDismissed key anywhere',
   HTML.indexOf("'installPromptDismissed'") === -1);
ok('dismissal is persisted', /localStorage\.setItem\(K_INSTALL_DISMISS,'1'\)/.test(HTML));

/* the Android trap — the actual field bug */
var wanted = /function installBannerWanted\(\)\{[\s\S]*?\n\}/.exec(HTML);
ok('installBannerWanted() found', !!wanted);
if(wanted){
  var w = wanted[0];
  ok('suppressed once installed', /if\(isStandalone\(\)\) return false;/.test(w));
  ok('suppressed once dismissed', /if\(localStorage\.getItem\(K_INSTALL_DISMISS\)\) return false;/.test(w));
  ok('NOT gated on deferredInstall — Android sees it before the event lands',
     w.indexOf('deferredInstall') === -1);
  ok('every other browser is wanted', /return true;/.test(w));
}

var render = /function renderBanners\(\)\{[\s\S]*?\n\}/.exec(HTML);
ok('renderBanners() found', !!render);
if(render){
  var r = render[0];
  ok('install is tested BEFORE the backup nudge',
     r.indexOf('installBannerWanted()') < r.indexOf('backupNudgeWanted()'));
  ok('backup nudge is the else-branch, not the leader',
     /\} else if\(backupNudgeWanted\(\)\)\{/.test(r));
  ok('iOS gets Share / Add to Home Screen', /tap Share, then/.test(r));
  /* the source keeps non-ASCII as \u escapes, so assert on the escape */
  ok('Android gets the menu instructions instead of silence',
     /On Android: tap the \\u22EE menu/.test(r));
  ok('the native Install button only appears with a real event',
     /deferredInstall\?'<button class="btn small" data-action="install">Install<\/button>':''/.test(r));
  ok('only ever one banner in the slot', (r.match(/host\.innerHTML=h;/g) || []).length === 1);
}

/* ---- backup nudge: the Aug-1 standard, unchanged by today's flip ---------- */
var nudge = /function backupNudgeWanted\(\)\{[\s\S]*?\n\}/.exec(HTML);
ok('backupNudgeWanted() found', !!nudge);
if(nudge){
  var n = nudge[0];
  ok('an empty app never nags', /if\(!hasRealData\(db\)\) return false;/.test(n));
  ok('threshold is 21 days, in ms', /21\*86400000/.test(n));
  ok('never-backed-up also triggers it', /!last \|\|/.test(n));
  ok('respects an active snooze', /if\(Date\.now\(\)<snooze\) return false;/.test(n));
}
ok('dismiss snoozes 7 days', /K_BACKUP_SNOOZE, String\(Date\.now\(\)\+7\*86400000\)/.test(HTML));
ok('backup key is paidup-prefixed', /K_BACKUP_SNOOZE='paidup\.backupNudgeSnoozeUntil'/.test(HTML));

/* ---- version stamps: index.html and the SW must agree --------------------- */
var vHtml = /window\.EGS_VERSION='(\d{4}\.\d{2}\.\d{2}-\d{4})';/.exec(HTML);
var vSw   = /var VERSION = '(\d{4}\.\d{2}\.\d{2}-\d{4})';/.exec(SW);
ok('index.html carries a deploy-stamped version', !!vHtml);
ok('service-worker.js carries a deploy-stamped version', !!vSw);
ok('the two stamps match', !!vHtml && !!vSw && vHtml[1] === vSw[1],
   (vHtml ? vHtml[1] : '?') + ' vs ' + (vSw ? vSw[1] : '?'));
ok('a visible footer stamp is rendered', /verFoot/.test(HTML));

/* ---- standing rules ------------------------------------------------------- */
ok('zero inline onclick', (HTML.match(/onclick=/g) || []).length === 0,
   (HTML.match(/onclick=/g) || []).length);
ok('no secrets committed', !/(api[_-]?key|secret|Bearer\s+[A-Za-z0-9]{16})/i.test(HTML));

/* Tier 1: every delete confirms. */
var spliceLines = HTML.split('\n')
  .map(function(line, i){ return { line: line, n: i + 1 }; })
  .filter(function(r){ return r.line.indexOf('.splice(') !== -1; });
var unguarded = spliceLines.filter(function(r){
  return r.line.indexOf('confirm(') === -1 && r.line.indexOf('askConfirm') === -1;
});
ok('every delete is confirm-guarded (' + spliceLines.length + ' checked)',
   unguarded.length === 0,
   unguarded.map(function(r){ return r.n; }).join(','));

console.log('\n' + p + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
