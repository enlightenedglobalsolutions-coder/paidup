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

/* ---- schema migration: v1 -> v2 (payment source) ---------------------------
   migrate() is self-contained (no closures over app state), so its extracted
   source can be eval'd and actually run against fixture stores — a regex
   checking for the literal 'bank' string would pass even if the upgrade path
   stopped setting it on the right object. This is what should fail the next
   time something touches migrate() and breaks the v1->v2 step. */
var migrateSrc = /function migrate\(obj\)\{[\s\S]*?\n\}/.exec(HTML);
ok('migrate() found', !!migrateSrc);
if(migrateSrc){
  var migrate = eval('(' + migrateSrc[0] + ')');
  var v1Store = { schema:1, categories:[], payments:[],
    settings:{theme:'system',beginner:true,lastBackupAt:null},
    bills:[{ id:'b1', name:'Rent', method:'manual' }] };            /* no source — legacy shape */
  var upgraded = migrate(v1Store);
  ok('v1 store upgrades to schema 2', upgraded.schema === 2, upgraded.schema);
  ok('v1 bill with no source defaults to bank',
     upgraded.bills[0].source === 'bank', upgraded.bills[0].source);

  var v2Store = { schema:2, categories:[], payments:[],
    settings:{theme:'system',beginner:true,lastBackupAt:null},
    bills:[{ id:'b2', name:'Card bill', method:'autopay', source:'card' }] };
  var passed = migrate(v2Store);
  ok('v2 store stays at schema 2', passed.schema === 2, passed.schema);
  ok('v2 bill with an existing source passes through untouched',
     passed.bills[0].source === 'card', passed.bills[0].source);
}

/* ---- cadence logic: occurrencesInMonth / statusFor / periodDisplay --------
   Found 2026-09-12: the "EGS PURE CADENCE LOGIC" block's own header comment
   claimed it was "behavior-tested (test_paidup.js) against real dates for
   all five cadences" — untrue until this section existed. Only migrate() had
   a real test; this block had none.
   Same extraction-and-eval technique as migrate() above: the block is
   self-contained day math with one outside dependency (MONTHS, a var
   declared just above it that periodDisplay reads), so both are extracted
   from the live source and actually run, not pattern-matched.
   Cases below are picked for where a wrong answer would be invisible rather
   than loud: day-31 clamping into February across a leap-year line, a
   quarterly anchor whose quarter crosses a year boundary, annual Feb-29
   clamping, a 5-occurrence weekly month, biweekly stepping across a DST
   transition (calendar-day arithmetic must not drift an hour into the wrong
   day), and statusFor's soon/upcoming boundary and the overdue check across
   a year line. Every date fact asserted below (weekdays, days-per-month,
   2026 DST transition dates) was independently verified against plain
   Date() output before being hardcoded — see the thread for the check. */
var CADENCE_START = '/* === EGS PURE CADENCE LOGIC START ===';
var CADENCE_END = '/* === EGS PURE CADENCE LOGIC END ===';
var csi = HTML.indexOf(CADENCE_START), cei = HTML.indexOf(CADENCE_END);
ok('cadence logic block markers found', csi !== -1 && cei !== -1 && csi < cei);
var monthsSrc = /var MONTHS=\[([\s\S]*?)\];/.exec(HTML);
ok('MONTHS array found (periodDisplay reads it)', !!monthsSrc);
var CAD = null;
if(csi !== -1 && cei !== -1 && monthsSrc){
  var afterHeader = HTML.indexOf('*/', csi) + 2;
  var cadenceSrc = HTML.slice(afterHeader, cei);
  try{
    var buildCadence = new Function('MONTHS', cadenceSrc
      + ';return {occurrencesInMonth:occurrencesInMonth, statusFor:statusFor, '
      + 'periodDisplay:periodDisplay, daysInMonth:daysInMonth, clampDay:clampDay};');
    CAD = buildCadence(eval('[' + monthsSrc[1] + ']'));
  }catch(e){ CAD = null; }
}
ok('cadence functions extracted and ran without throwing', !!CAD);

if(CAD){
  /* -- day-31 clamping into February, leap and non-leap -- */
  ok('daysInMonth: Feb 2026 (non-leap) has 28 days', CAD.daysInMonth(2026,1) === 28, CAD.daysInMonth(2026,1));
  ok('daysInMonth: Feb 2024 (leap) has 29 days', CAD.daysInMonth(2024,1) === 29, CAD.daysInMonth(2024,1));
  ok('clampDay: day 31 clamps to 28 in Feb 2026', CAD.clampDay(2026,1,31) === 28, CAD.clampDay(2026,1,31));
  ok('clampDay: day 31 clamps to 29 in Feb 2024 (leap)', CAD.clampDay(2024,1,31) === 29, CAD.clampDay(2024,1,31));

  var monthlyFeb26 = CAD.occurrencesInMonth({ cadence:'monthly', dueDay:31 }, 2026, 1);
  ok('monthly dueDay 31 clamps to Feb 28 in a non-leap year',
     monthlyFeb26.length === 1 && monthlyFeb26[0].dueDate === '2026-02-28', JSON.stringify(monthlyFeb26));
  var monthlyFeb24 = CAD.occurrencesInMonth({ cadence:'monthly', dueDay:31 }, 2024, 1);
  ok('monthly dueDay 31 clamps to Feb 29 in a leap year',
     monthlyFeb24.length === 1 && monthlyFeb24[0].dueDate === '2024-02-29', JSON.stringify(monthlyFeb24));

  /* -- quarterly anchor whose quarter crosses a year boundary --
     Anchor month = November (index 10) -> quarters fall Nov/Feb/May/Aug. */
  var novAnchor = { cadence:'quarterly', dueMonth:10, dueDay:15 };
  var qJan = CAD.occurrencesInMonth(novAnchor, 2027, 0);
  ok('quarterly Nov-anchor does NOT fire in January (year-boundary miss)',
     qJan.length === 0, JSON.stringify(qJan));
  var qFeb = CAD.occurrencesInMonth(novAnchor, 2027, 1);
  ok('quarterly Nov-anchor fires in February of the following year',
     qFeb.length === 1 && qFeb[0].dueDate === '2027-02-15', JSON.stringify(qFeb));
  ok('that February period is labelled by calendar quarter (Q1), not anchor-relative',
     qFeb.length === 1 && qFeb[0].period === '2027-Q1', qFeb[0] && qFeb[0].period);
  var qNov = CAD.occurrencesInMonth(novAnchor, 2026, 10);
  ok('quarterly Nov-anchor fires in November itself',
     qNov.length === 1 && qNov[0].dueDate === '2026-11-15', JSON.stringify(qNov));

  /* -- annual clamping: Feb 29 due date -- */
  var annFeb26 = CAD.occurrencesInMonth({ cadence:'annual', dueMonth:1, dueDay:29 }, 2026, 1);
  ok('annual Feb 29 clamps to the 28th in a non-leap year',
     annFeb26.length === 1 && annFeb26[0].dueDate === '2026-02-28', JSON.stringify(annFeb26));
  var annFeb24 = CAD.occurrencesInMonth({ cadence:'annual', dueMonth:1, dueDay:29 }, 2024, 1);
  ok('annual Feb 29 lands on the 29th in a leap year',
     annFeb24.length === 1 && annFeb24[0].dueDate === '2024-02-29', JSON.stringify(annFeb24));
  var annOtherMonth = CAD.occurrencesInMonth({ cadence:'annual', dueMonth:1, dueDay:29 }, 2026, 2);
  ok('annual bill does not fire outside its one due month',
     annOtherMonth.length === 0, JSON.stringify(annOtherMonth));

  /* -- weekly month with five occurrences (August 2026 has 5 Mondays) -- */
  var fiveMondays = CAD.occurrencesInMonth({ cadence:'weekly', dueWeekday:1 }, 2026, 7);
  var expectedMondays = ['2026-08-03','2026-08-10','2026-08-17','2026-08-24','2026-08-31'];
  ok('weekly bill produces all 5 Mondays in August 2026',
     JSON.stringify(fiveMondays.map(function(o){ return o.dueDate; })) === JSON.stringify(expectedMondays),
     JSON.stringify(fiveMondays));
  ok('weekly period key equals its own dueDate (one payment record per date)',
     fiveMondays.length === 5 && fiveMondays.every(function(o){ return o.period === o.dueDate; }));

  /* -- biweekly across a DST change --
     2026 North American DST: spring forward Mar 8, fall back Nov 1.
     occurrencesInMonth builds dates via Date(y,m,d+14k) — calendar-day
     arithmetic, not epoch-ms — so it must not drift a day either way. */
  var springBiweekly = CAD.occurrencesInMonth({ cadence:'biweekly', anchorDate:'2026-02-23' }, 2026, 2);
  ok('biweekly stays on Monday across the spring-forward DST change',
     JSON.stringify(springBiweekly.map(function(o){ return o.dueDate; })) === JSON.stringify(['2026-03-09','2026-03-23']),
     JSON.stringify(springBiweekly));
  var fallBiweekly = CAD.occurrencesInMonth({ cadence:'biweekly', anchorDate:'2026-10-19' }, 2026, 10);
  ok('biweekly stays on Monday across the fall-back DST change',
     JSON.stringify(fallBiweekly.map(function(o){ return o.dueDate; })) === JSON.stringify(['2026-11-02','2026-11-16','2026-11-30']),
     JSON.stringify(fallBiweekly));

  /* -- statusFor boundaries at the year line -- */
  ok('statusFor: exactly 5 days out is "soon" (inclusive boundary)',
     CAD.statusFor({ paid:false, dueDate:'2027-01-05' }, '2026-12-31') === 'soon');
  ok('statusFor: exactly 6 days out is "upcoming", crossing the new year',
     CAD.statusFor({ paid:false, dueDate:'2027-01-06' }, '2026-12-31') === 'upcoming');
  ok('statusFor: a date from last year reads overdue against a new-year today',
     CAD.statusFor({ paid:false, dueDate:'2026-12-30' }, '2027-01-01') === 'overdue');
  ok('statusFor: paid wins regardless of date',
     CAD.statusFor({ paid:true, dueDate:'2020-01-01' }, '2027-01-01') === 'paid');

  /* -- periodDisplay: every period-key shape occurrencesInMonth can produce,
     including the year-crossing quarter label exercised above -- */
  ok('periodDisplay: monthly key (YYYY-MM)', CAD.periodDisplay('2027-02') === 'February 2027', CAD.periodDisplay('2027-02'));
  ok('periodDisplay: quarterly key (YYYY-Qn), same one qFeb produced',
     CAD.periodDisplay('2027-Q1') === 'Q1 2027', CAD.periodDisplay('2027-Q1'));
  ok('periodDisplay: annual key (YYYY)', CAD.periodDisplay('2027') === '2027', CAD.periodDisplay('2027'));
  ok('periodDisplay: dated key (YYYY-MM-DD)', CAD.periodDisplay('2026-08-31') === 'Aug 31, 2026', CAD.periodDisplay('2026-08-31'));
}

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
/* window.EGS_VERSION now stamps as 'DATE (shortsha)' (egs-deploy.sh commit
   9e802a2) while service-worker.js's VERSION stays a bare date — so this
   only compares the date portion, not the full string. */
var vHtml = /window\.EGS_VERSION='(\d{4}\.\d{2}\.\d{2}-\d{4})(?: \([0-9a-f]+\))?';/.exec(HTML);
var vSw   = /var VERSION = '(\d{4}\.\d{2}\.\d{2}-\d{4})';/.exec(SW);
ok('index.html carries a deploy-stamped version', !!vHtml);
ok('service-worker.js carries a deploy-stamped version', !!vSw);
ok('the two stamps\' dates match', !!vHtml && !!vSw && vHtml[1] === vSw[1],
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
