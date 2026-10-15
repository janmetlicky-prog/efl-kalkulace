// APP-K2 BĚH 3 — testy nad funkcemi extrahovanými z index.html (bez sítě, bez DOM)
// spuštění: node tests/test_appk2_beh3.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/)[1];
const G = globalThis; globalThis.G = globalThis;

function cut(name, kind = 'function') {
  let i = src.indexOf(kind + ' ' + name + (kind === 'function' ? '(' : ' '));
  assert.ok(i >= 0, name + ' nenalezen');
  if (kind === 'function' && src.slice(i - 6, i) === 'async ') i -= 6;
  const after = src.slice(i + 1);
  const ends = ['\nfunction ', '\nasync function ', '\nconst ', '\nlet ', '\n// ═'].map(k => after.indexOf(k)).filter(x => x >= 0);
  return src.slice(i, i + 1 + Math.min(...ends)) + '\n';
}
const load = (names, kind) => names.forEach(n => { const code = cut(n, kind); (0, eval)(code.replace(/^(async )?function/, 'G.' + n + ' = $1function').replace(/^const (\w+) = /, 'G.$1 = ')); });

// ── shimy prostředí ──
G.window = { crypto: null };
G.esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
G.GH_REPO = 'x/y'; G.GH_BRANCH = 'main';
G.ghToken = () => 'tok';
G.getNick = () => 'Honza';
G.db = { trips: [] };
G.ghSetSha = () => {};
G.console = console;

load(['K2_OUTBOX_ROOT', 'K2_DRAFTS_ROOT', 'K2_TEMPLATES_PATH', 'K2_MAX_RECIPIENTS', 'K2_QUEUED_STALE_H', 'K2_MARKER_RE', 'K2_ALLOWED_TAGS'], 'const');
(0, eval)(cut('K2_DEFAULT_TEMPLATE', 'const').replace(/^const /, 'G.'));
load(['k2NowIso', 'k2Hash8', 'k2TripKey', 'k2Uuid', 'k2FmtDate', 'k2Termin', 'k2SanitizeHtml', 'k2HtmlToText', 'k2CountMarkers',
      'k2Warnings', 'k2Highlight', 'k2FillPlaceholders', 'k2OutboxYears', 'k2ParticipantStates', 'k2NowIsoOf', 'k2BuildRecipients',
      'k2FindParticipant', 'k2DiffOutsidePreDeparture', 'k2Btns']);
(0, eval)(cut('k2LoadOutbox').replace(/^async function/, 'G.k2LoadOutbox = async function'));
(0, eval)(cut('k2DbWrite').replace(/^async function/, 'G.k2DbWrite = async function'));

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const trip = () => ({
  id: 't_senegal', name: 'Senegal 2026', date: '14.11. - 22.11.', year: 2026, hotelName: 'Oasis Club', hotelUrl: 'https://oasis.example',
  destination: 'Senegal', instructor: 'Karolína Tou-Jou',
  participants: [
    { id: 'p1', name: 'Jana Nová', email: 'jana@x.cz' },
    { id: 'p2', name: 'Petr Novák', email: 'novak@x.cz' },
    { id: 'p3', name: 'Eva Nováková', email: 'novak@x.cz' },
    { id: 'p4', name: 'Zrušená', email: 'z@x.cz', isCancelled: true },
    { id: 'p5', name: 'Bez Emailu', email: '' },
  ]
});
const rec = (over) => Object.assign({ v: 1, id: 'aaaaaaaa-0000-4000-8000-000000000001', type: 'predodlet', tripId: 't_senegal', tripName: 'Senegal 2026',
  createdAt: '2026-10-14T09:00:00', status: 'sent', recipients: [{ email: 'jana@x.cz', participantIds: ['p1'] }, { email: 'novak@x.cz', participantIds: ['p2', 'p3'] }],
  results: [{ email: 'jana@x.cz', ok: true, at: '2026-10-14T09:05:00' }, { email: 'novak@x.cz', ok: true, at: '2026-10-14T09:05:02' }] }, over);
const NOW = '2026-10-14T12:00:00';

console.log('\n── 1. stavy účastníků ──');
await t('sent / none / shared', () => {
  const st = k2ParticipantStates(trip(), [rec()], NOW);
  assert.equal(st.p1.kind, 'sent'); assert.equal(st.p1.at, '2026-10-14T09:05:00');
  assert.equal(st.p2.kind, 'sent'); assert.equal(st.p3.kind, 'sent');
  assert.equal(st.p5.kind, 'none'); assert.equal(st.p4, undefined);
});
await t('queued čerstvý = ⏳, queued starší 24 h se ignoruje', () => {
  let st = k2ParticipantStates(trip(), [rec({ status: 'queued', results: [], createdAt: '2026-10-14T11:00:00' })], NOW);
  assert.equal(st.p1.kind, 'queued');
  st = k2ParticipantStates(trip(), [rec({ status: 'queued', results: [], createdAt: '2026-10-12T11:00:00' })], NOW);
  assert.equal(st.p1.kind, 'none');
});
await t('partial: ok příjemce = sent, neúspěšný = error s textem', () => {
  const r = rec({ status: 'partial', results: [{ email: 'jana@x.cz', ok: true, at: 'x' }, { email: 'novak@x.cz', ok: false, error: '550 odmítnuto' }] });
  const st = k2ParticipantStates(trip(), [r], NOW);
  assert.equal(st.p1.kind, 'sent'); assert.equal(st.p2.kind, 'error'); assert.equal(st.p2.error, '550 odmítnuto');
});
await t('dry záznam = nic neodešlo; novější záznam vítězí', () => {
  const dry = rec({ id: 'bbbbbbbb-0000-4000-8000-000000000002', status: 'dry', createdAt: '2026-10-14T10:00:00', results: [] });
  assert.equal(k2ParticipantStates(trip(), [dry], NOW).p1.kind, 'none');
  const err = rec({ id: 'cccccccc-0000-4000-8000-000000000003', status: 'error', createdAt: '2026-10-13T10:00:00', results: [{ email: 'jana@x.cz', ok: false, error: 'x' }] });
  assert.equal(k2ParticipantStates(trip(), [rec(), err], NOW).p1.kind, 'sent');       // seřazeno od nejnovějšího
});
await t('záloha z preDeparture (outbox prázdný)', () => {
  const tr = trip(); tr.participants[0].preDeparture = { sent: { at: '2026-09-01T10:00:00', outboxId: 'old' } };
  tr.participants[1].preDeparture = { queued: { at: '2026-10-14T11:30:00', outboxId: 'q' } };
  tr.participants[2].preDeparture = { queued: { at: '2026-10-01T11:30:00', outboxId: 'q2' } };
  const st = k2ParticipantStates(tr, [], NOW);
  assert.equal(st.p1.kind, 'sent'); assert.equal(st.p2.kind, 'queued'); assert.equal(st.p3.kind, 'none');
});

console.log('\n── 2. příjemci ──');
await t('bez emailu a zrušení ven; sdílená adresa = 1 email s oběma id', () => {
  const r = k2BuildRecipients(trip(), ['p1', 'p2', 'p3', 'p4', 'p5']);
  assert.equal(r.length, 2);
  const nov = r.find(x => x.email === 'novak@x.cz');
  assert.deepEqual(nov.participantIds, ['p2', 'p3']);
  assert.deepEqual(k2BuildRecipients(trip(), ['p5']), []);
});
await t('participantIds jen z vybraných', () => {
  const r = k2BuildRecipients(trip(), ['p2']);
  assert.deepEqual(r[0].participantIds, ['p2']);
});

console.log('\n── 3. placeholdery a markery ──');
await t('dosazení z dat cesty, odkaz hotelUrl, rok k termínu', () => {
  const out = k2FillPlaceholders('{{cesta}}|{{hotel}}|{{hotelUrl}}|{{termin}}|{{lektor}}|{{destinace}}', trip());
  assert.equal(out, 'Senegal 2026|Oasis Club|<a href="https://oasis.example">https://oasis.example</a>|14.11. - 22.11. 2026|Karolína Tou-Jou|Senegal');
});
await t('prázdná hodnota → marker, neznámý placeholder zůstane, escapování', () => {
  const tr = trip(); tr.hotelUrl = ''; tr.name = 'A <b> & C';
  const out = k2FillPlaceholders('{{hotelUrl}} {{neznamy}} {{cesta}}', tr);
  assert.equal(out, '[DOPLNIT: hotelUrl] {{neznamy}} A &lt;b&gt; &amp; C');
  assert.equal(k2CountMarkers(out), 2);
});
await t('termín s rokem se nezdvojí', () => {
  const tr = trip(); tr.date = '1.2.2027 - 12.2.2027';
  assert.equal(k2Termin(tr), '1.2.2027 - 12.2.2027');
});
await t('počítání markerů z textu (i přes tagy), varování ??/TODO', () => {
  assert.equal(k2CountMarkers('<p>[DOPLNIT: <strong>letenky</strong>]</p><p>{{x}}</p><p>[VOLITELNÁ SEKCE — smaž]</p>'), 3);
  assert.equal(k2CountMarkers('<p>hotovo</p>'), 0);
  assert.deepEqual(k2Warnings('<p>90 + 22 ??</p>'), ['v textu je „??" — nejasná hodnota']);
  assert.deepEqual(k2Warnings('<p>ok</p>'), []);
});
await t('vestavěná kostra: oslovení, markery, placeholdery', () => {
  assert.ok(K2_DEFAULT_TEMPLATE.bodyHtml.startsWith('<p>Milí spolucestovatelé,</p>'));
  assert.ok(k2CountMarkers(K2_DEFAULT_TEMPLATE.bodyHtml) >= 15);
  const filled = k2FillPlaceholders(K2_DEFAULT_TEMPLATE.bodyHtml, trip());
  assert.ok(!/\{\{/.test(filled), 'všechny placeholdery kostry dosazeny');
  assert.ok(k2CountMarkers(filled) > 0, 'cestové sekce zůstávají k doplnění');
  assert.equal(k2FillPlaceholders(K2_DEFAULT_TEMPLATE.subject, trip()), 'Předodletové informace — Senegal 2026');
  assert.ok(!K2_DEFAULT_TEMPLATE.bodyHtml.includes('Adéla') && !K2_DEFAULT_TEMPLATE.bodyHtml.includes('Za tým'), 'podpis doplňuje worker, v kostře být nesmí');
  assert.ok(K2_DEFAULT_TEMPLATE.bodyHtml.endsWith('<p>Máváme a zdravíme od Litoměřic.</p>'));
});
await t('editor nese poznámku o automatickém podpisu', () => {
  (0, eval)(cut('k2Editor').replace(/^function/, 'G.k2Editor = function'));
  G.k2InsertLink = () => {};
  assert.ok(k2Editor('x', '<p>a</p>').includes('Podpis EFL se doplní automaticky'));
});
await t('zvýraznění markerů je idempotentní', () => {
  const a = k2Highlight('<p>[DOPLNIT: x] text</p>');
  assert.ok(a.includes('<span class="k2-marker">[DOPLNIT: x]</span>'));
  assert.equal(k2Highlight(a), a);
});

console.log('\n── 4. sanitizer (stejný whitelist jako worker) ──');
await t('script/style/iframe pryč včetně obsahu', () => {
  const o = k2SanitizeHtml('<p>a</p><script>alert(1)</script><style>p{}</style><iframe src="http://evil"></iframe><p>b</p>');
  assert.ok(!o.includes('alert') && !o.includes('evil') && !o.includes('p{}'));
  assert.equal(o, '<p>a</p><p>b</p>');
});
await t('atributy a události pryč, href jen https/mailto', () => {
  assert.equal(k2SanitizeHtml('<p onclick="x()" style="color:red" class="k2-marker">t</p>'), '<p>t</p>');
  assert.equal(k2SanitizeHtml('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(k2SanitizeHtml('<a href="https://a.cz/?x=1&amp;y=2" target="_blank">x</a>'), '<a href="https://a.cz/?x=1&amp;y=2">x</a>');
  assert.equal(k2SanitizeHtml('<a href="https://a.cz/?x=1&y=2">x</a>'), '<a href="https://a.cz/?x=1&amp;y=2">x</a>');
  assert.equal(k2SanitizeHtml("<a href='mailto:info@essenceforlife.cz'>m</a>"), '<a href="mailto:info@essenceforlife.cz">m</a>');
});
await t('Word balast a neznámé tagy pryč, text zůstane', () => {
  const o = k2SanitizeHtml('<p class=MsoNormal><o:p></o:p><span style="font-size:10pt">Text</span><font color=red>!</font></p><!-- c -->');
  assert.equal(o, '<p><span>Text</span>!</p>');
});
await t('html→text', () => {
  const tx = k2HtmlToText('<p>A&nbsp;B</p><ul><li>x</li></ul><br>C &amp; D');
  assert.ok(tx.includes('A B') && tx.includes('x') && tx.includes('C & D'));
});

console.log('\n── 5. gate + atomický zápis ──');
await t('gate: změna preDeparture projde, jiná blokuje', () => {
  const a = { trips: [trip()] }, b = JSON.parse(JSON.stringify(a));
  b.trips[0].participants[0].preDeparture = { queued: { at: 'x' } };
  assert.equal(k2DiffOutsidePreDeparture(a, b), false);
  b.trips[0].participants[0].vs = '9';
  assert.equal(k2DiffOutsidePreDeparture(a, b), true);
});
await t('identita: id + trip id+name (duplicitní trip.id)', () => {
  const d = { trips: [{ id: 'dup', name: 'A', participants: [{ id: 'x1' }] }, { id: 'dup', name: 'B', participants: [{ id: 'x1', mark: 'B' }] }] };
  assert.equal(k2FindParticipant(d, { id: 'x1', tripId: 'dup', tripName: 'B' }).mark, 'B');
  assert.equal(k2FindParticipant(d, { id: 'x1', tripId: 'dup', tripName: 'C' }), null);
});
await t('k2DbWrite: stale → čerstvá data + reaplikace, nikdy force', async () => {
  G.db = { trips: [trip()] };
  const fresh = { trips: [trip()] }; fresh.trips[0].participants.push({ id: 'cizi', name: 'Cizí', email: 'c@x.cz' });
  const calls = [];
  G.saveAwait = async (data) => { calls.push(JSON.parse(JSON.stringify(data))); return calls.length === 1 ? { ok: false, stale: true } : { ok: true, sha: 'S2' }; };
  G.ghLoad = async () => JSON.parse(JSON.stringify(fresh));
  G.migrateData = d => d;
  const r = await k2DbWrite([{ id: 'p1', tripId: 't_senegal', tripName: 'Senegal 2026', apply: p => { p.preDeparture = { queued: { outboxId: 'o' } }; } }]);
  assert.equal(r.ok, true); assert.equal(calls.length, 2);
  assert.ok(calls[1].trips[0].participants.some(p => p.id === 'cizi'), 'cizí změna přežila');
  assert.equal(calls[1].trips[0].participants[0].preDeparture.queued.outboxId, 'o');
  assert.equal(G.db.trips[0].participants.length, 6);
});
await t('k2DbWrite: 2× stale → chyba bez force; gate uvnitř', async () => {
  G.db = { trips: [trip()] };
  G.saveAwait = async () => ({ ok: false, stale: true });
  G.ghLoad = async () => ({ trips: [trip()] });
  let r = await k2DbWrite([{ id: 'p1', tripId: 't_senegal', tripName: 'Senegal 2026', apply: p => { p.preDeparture = {}; } }]);
  assert.equal(r.ok, false); assert.match(r.error, /konflikt/);
  let saved = 0; G.saveAwait = async () => { saved++; return { ok: true, sha: 's' }; };
  r = await k2DbWrite([{ id: 'p1', tripId: 't_senegal', tripName: 'Senegal 2026', apply: p => { p.vs = 'ZLE'; } }]);
  assert.equal(r.ok, false); assert.match(r.error, /mimo preDeparture/); assert.equal(saved, 0);
});

console.log('\n── 6. outbox: klíč, cesty, načtení ──');
await t('tripKey stabilní, bezpečné znaky, rozliší duplicitní id', () => {
  const a = k2TripKey({ id: 'sml_azoryportuga', name: 'Azory A' }), b = k2TripKey({ id: 'sml_azoryportuga', name: 'Azory B' });
  assert.notEqual(a, b); assert.equal(a, k2TripKey({ id: 'sml_azoryportuga', name: 'Azory A' }));
  assert.match(k2TripKey({ id: 'sml_Jógová I/0', name: 'x' }), /^[A-Za-z0-9_-]+$/);
});
await t('k2LoadOutbox: filtr podle klíče v názvu + tripId+tripName, chyba výpisu = error', async () => {
  const tr = trip(); const key = k2TripKey(tr);
  const other = { id: 't_senegal', name: 'Senegal 2026 (kopie)' };
  G.k2GhList = async (dir) => dir.endsWith('/2026') ? [
    { name: '20261014T090000_' + key + '_predodlet_aaaaaaaa.json', path: 'p1' },
    { name: '20261014T090000_' + k2TripKey(other) + '_predodlet_bbbbbbbb.json', path: 'p2' },
    { name: '20261013T090000_' + key + '_lektor_cccccccc.json', path: 'p3' }] : [];
  G.ghLoadFile = async (path) => ({ status: 'OK', data: path === 'p1' ? rec() : path === 'p3' ? rec({ type: 'lektor', createdAt: '2026-10-13T09:00:00' }) : rec({ tripName: 'Senegal 2026 (kopie)' }) });
  const r = await k2LoadOutbox(tr, [2026]);
  assert.equal(r.error, null); assert.equal(r.recs.length, 2);
  assert.equal(r.recs[0].type, 'predodlet');                       // nejnovější první
  G.k2GhList = async () => { throw new Error('list_500'); };
  const e = await k2LoadOutbox(tr, [2026]);
  assert.equal(e.error, 'list_500');
});
await t('k2OutboxYears: leden zahrne předchozí rok', () => {
  const ys = k2OutboxYears(); assert.ok(ys.length >= 1 && ys.includes(new Date().getFullYear()));
});
await t('uuid formát, iso formát', () => {
  assert.match(k2Uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(k2NowIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

console.log('\n── 6b. draft: chybějící složka = nový soubor ──');
(0, eval)(cut('k2LoadDraft').replace(/^async function/, 'G.k2LoadDraft = async function'));
await t('k2LoadDraft: ABSENT i dir_list_404 → absent=true; jiná UNREADABLE → false', async () => {
  const tr = { id: 't1', name: 'X' };
  G.ghLoadFile = async () => ({ status: 'ABSENT' });
  assert.equal((await k2LoadDraft(tr)).absent, true);
  G.ghLoadFile = async () => ({ status: 'UNREADABLE', error: 'dir_list_404' });
  assert.equal((await k2LoadDraft(tr)).absent, true);
  G.ghLoadFile = async () => ({ status: 'UNREADABLE', error: 'http_500' });
  assert.equal((await k2LoadDraft(tr)).absent, false);
  G.ghLoadFile = async () => ({ status: 'OK', data: { tripId: 't1', tripName: 'X', subject: 's', bodyHtml: 'b' } });
  const r = await k2LoadDraft(tr); assert.equal(r.absent, false); assert.equal(r.draft.subject, 's');
  G.ghLoadFile = async () => ({ status: 'OK', data: { tripId: 't1', tripName: 'JINÁ', subject: 's', bodyHtml: 'b' } });
  assert.equal((await k2LoadDraft(tr)).draft, null);
});

console.log('\n── 7. oprávnění ──');
await t('tlačítko bez admin-only, bez omezení na status', () => {
  const b = k2Btns({ id: 't1', status: 'storno' });
  assert.ok(b.includes('k2OpenPredodlet') && !b.includes('admin-only') && !b.includes('colleague'));
});
await t('v bloku APP-K2 není žádné omezení rolí u odeslání (jen kostra admin)', () => {
  const blk = src.slice(src.indexOf('PŘEDODLETOVÉ INFO (APP-K2'), src.indexOf('UPOMÍNKY (APP-K1)'));
  const adminUses = (blk.match(/isAdmin\(\)/g) || []).length;
  assert.equal(adminUses, 2, 'isAdmin jen v k2OpenTemplateEditor + k2TplSave');
  assert.ok(!blk.includes('ledgerPerm('));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
