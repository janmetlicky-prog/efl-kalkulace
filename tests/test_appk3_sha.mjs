// APP-K3 — per-tab SHA, ghLoad bez „SHA bez dat", žádný force po 409
// spuštění: node tests/test_appk3_sha.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/)[1];
const G = globalThis; G.G = G;

function cut(name, kind = 'function') {
  let i = src.indexOf(kind + ' ' + name + (kind === 'function' ? '(' : ' '));
  assert.ok(i >= 0, name + ' nenalezen');
  if (kind === 'function' && src.slice(i - 6, i) === 'async ') i -= 6;
  const after = src.slice(i + 1);
  const ends = ['\nfunction ', '\nasync function ', '\nconst ', '\nlet ', '\n// ═', '\n// ─', '\n/**'].map(k => after.indexOf(k)).filter(x => x >= 0);
  return src.slice(i, i + 1 + Math.min(...ends)) + '\n';
}
const load = (names, kind) => names.forEach(n => (0, eval)(cut(n, kind)
  .replace(/^(async )?function/, 'G.' + n + ' = $1function').replace(/^const (\w+) = /, 'G.$1 = ')));

// ── shimy: sdílené localStorage (= jeden prohlížeč), per-tab paměť = _ghTabSha ──
const store = {};
G.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
G.GH_REPO = 'x/y'; G.GH_FILE = 'data/db.json'; G.GH_BRANCH = 'main';
G.ghToken = () => 'tok';
G.console = console;
G.TextDecoder = class { decode(b) { return Buffer.from(b).toString('utf8'); } };
G.atob = s => Buffer.from(s, 'base64').toString('binary');
G.btoa = s => Buffer.from(s, 'binary').toString('base64');
G.unescape = s => decodeURIComponent(s);
G.encodeURIComponent = encodeURIComponent;
let conflictShown = 0; G.showGhConflictWarning = () => { conflictShown++; };

load(['_ghTabSha'], 'const');
load(['ghSetSha', 'ghGetSha', 'ghShaKey', 'ghGetShaFor', 'ghSetShaFor', 'ghLoad', 'ghSaveWithToken']);

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); } }
const newTab = () => { for (const k of Object.keys(G._ghTabSha)) delete G._ghTabSha[k]; };

console.log('\n── per-tab SHA ──');
await t('SHA se čte z paměti tabu, ne z localStorage', () => {
  newTab();
  ghSetSha('S1');
  assert.equal(ghGetSha(), 'S1');
  assert.equal(store['efl_gh_sha'], 'S1');                 // zrcadlo zůstává
  store['efl_gh_sha'] = 'S2';                                // jiný tab (nebo jeho polling) obnovil sdílené úložiště
  assert.equal(ghGetSha(), 'S1', 'tab nesmí převzít cizí SHA k vlastním starým datům');
});
await t('nový tab začíná bez SHA (ne z localStorage) → musí načíst', () => {
  store['efl_gh_sha'] = 'S9';
  newTab();
  assert.equal(ghGetSha(), '');
});
await t('per-path SHA (ledger/finance) stejně per-tab', () => {
  newTab();
  ghSetShaFor('data/payments-ledger.json', 'L1');
  store[ghShaKey('data/payments-ledger.json')] = 'L2';
  assert.equal(ghGetShaFor('data/payments-ledger.json'), 'L1');
  assert.equal(ghGetSha(), '');
});

console.log('\n── ghLoad ──');
const b64 = obj => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
await t('SHA se nastaví až s úspěšně dekódovanými daty', async () => {
  newTab(); ghSetSha('OLD');
  G.fetch = async () => ({ ok: true, json: async () => ({ sha: 'BROKEN', content: '!!!nevalidni-base64-json' }) });
  const r = await ghLoad();
  assert.equal(r, null);
  assert.equal(ghGetSha(), 'OLD', 'při selhání dekódování nesmí tab dostat čerstvou SHA');
  G.fetch = async () => ({ ok: true, json: async () => ({ sha: 'NEW', content: b64({ trips: [1] }) }) });
  const ok = await ghLoad();
  assert.deepEqual(ok, { trips: [1] }); assert.equal(ghGetSha(), 'NEW');
});

console.log('\n── ghSaveWithToken (auto-logout) ──');
await t('409 → žádný druhý PUT, žádný force, varování, false', async () => {
  newTab(); ghSetSha('STALE'); conflictShown = 0;
  const calls = [];
  G.fetch = async (url, opts) => { calls.push((opts && opts.method) || 'GET'); return { ok: false, status: 409, json: async () => ({ message: 'conflict' }) }; };
  const r = await ghSaveWithToken({ trips: [] }, 'tok');
  assert.equal(r, false);
  assert.deepEqual(calls, ['PUT'], 'po 409 nesmí následovat GET sha + druhý PUT');
  assert.equal(conflictShown, 1);
  assert.equal(ghGetSha(), 'STALE');
});
await t('úspěch → SHA z odpovědi', async () => {
  newTab(); ghSetSha('A');
  const bodies = [];
  G.fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ content: { sha: 'B' } }) }; };
  assert.equal(await ghSaveWithToken({ trips: [] }, 'tok'), true);
  assert.equal(bodies[0].sha, 'A'); assert.equal(ghGetSha(), 'B');
});
await t('v souboru už není žádný retry PUT po konfliktu', () => {
  const fn = cut('ghSaveWithToken');
  assert.ok(!/retry\s*=\s*await fetch/.test(fn) && !/fresh\.ok/.test(fn));
  assert.ok(!/localStorage\.getItem\('efl_gh_sha'\)/.test(src), 'SHA se nikde nečte z localStorage');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
