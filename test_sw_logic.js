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

console.log(pass + '/' + (pass+fail) + ' sw_logic tests pass');
process.exit(fail ? 1 : 0);
