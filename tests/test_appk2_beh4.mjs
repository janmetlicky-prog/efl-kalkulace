// APP-K2 BĚH 4 — lektor (stavy slovy, řazení, OCHRANA ÚDAJŮ) + karta Odeslané emaily
// spuštění: node tests/test_appk2_beh4.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/)[1];
globalThis.G = globalThis;

function cut(name, kind = 'function') {
  let i = src.indexOf(kind + ' ' + name + (kind === 'function' ? '(' : ' '));
  assert.ok(i >= 0, name + ' nenalezen');
  if (kind === 'function' && src.slice(i - 6, i) === 'async ') i -= 6;
  const after = src.slice(i + 1);
  const ends = ['\nfunction ', '\nasync function ', '\nconst ', '\nlet ', '\n// ═', '\n// ─'].map(k => after.indexOf(k)).filter(x => x >= 0);
  return src.slice(i, i + 1 + Math.min(...ends)) + '\n';
}
const load = (names, kind) => names.forEach(n => {
  const code = cut(n, kind);
  (0, eval)(code.replace(/^(async )?function/, 'G.' + n + ' = $1function').replace(/^const (\w+) = /, 'G.$1 = ').replace(/^let (\w+) = /, 'G.$1 = '));
});
G.esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
G.window = {}; G.db = { trips: [] }; G.currentTripId = null; G.console = console;
load(['K2_MARKER_RE', 'K2_ALLOWED_TAGS', 'K2_WRAP_STYLE', 'K2_MIGRATION_BATCH', 'K2_TYPE_LABEL', 'K2_STATUS_LABEL', 'K2_EMAIL_RE'], 'const');
load(['_k2LogCache', '_k2LogFilter'], 'let');
load(['k2NowIso', 'k2NowIsoOf', 'k2Hash8', 'k2TripKey', 'k2Termin', 'k2SanitizeHtml', 'k2HtmlToText', 'k2CountMarkers', 'k2FmtDateFull',
      'k2RegAt', 'k2RegOrder', 'k2PayColumns', 'k2PayWords', 'k2BuildLectorTable', 'k2LectorSummaryHtml', 'k2LectorBody',
      'k2InstructorMatches', 'k2FindInstructors', 'k2LogWhen', 'k2FmtDateTime', 'k2LogCardHtml', 'k2Btns']);
(0, eval)(cut('k2IsPaidWord', 'const').replace(/^const /, 'G.'));

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const TODAY = '2026-10-14';
const st = (status, inst, overdue) => ({ status, installments: inst, overdue: !!overdue, paidTotal: 13750, dueTotal: 27500, balance: 13750, currency: 'CZK' });
const I2 = [{ amount: 13750, due: '2026-04-04', paid: 13750, remaining: 0 }, { amount: 13750, due: '2027-02-20', paid: 0, remaining: 13750 }];

console.log('\n── 1. stavy plateb slovy ──');
await t('zaplaceno / preplatek / nezaplaceno / splatka_1_ok / castecne_1', () => {
  assert.deepEqual(k2PayWords(st('zaplaceno', I2), TODAY).words, ['zaplaceno', 'zaplaceno']);
  assert.deepEqual(k2PayWords(st('preplatek', I2), TODAY).words, ['zaplaceno', 'zaplaceno']);
  assert.deepEqual(k2PayWords(st('nezaplaceno', I2), TODAY).words, ['nezaplaceno', 'nezaplaceno']);
  assert.deepEqual(k2PayWords(st('splatka_1_ok', I2), TODAY).words, ['zaplaceno', 'nezaplaceno']);
  assert.deepEqual(k2PayWords(st('castecne_1', I2), TODAY).words, ['částečně', 'nezaplaceno']);
  assert.deepEqual(k2PayWords(st('castecne_2', I2), TODAY).words, ['zaplaceno', 'částečně']);
});
await t('3 splátky, v_cene_jineho, bez rozpisu, žádný záznam, historie', () => {
  const I3 = I2.concat([{ amount: 1, due: '2027-03-01', paid: 0, remaining: 1 }]);
  assert.deepEqual(k2PayWords(st('splatka_2_ok', I3), TODAY).words, ['zaplaceno', 'zaplaceno', 'nezaplaceno']);
  assert.deepEqual(k2PayWords(st('v_cene_jineho', I2), TODAY).words, ['hrazeno jiným účastníkem', 'hrazeno jiným účastníkem']);
  assert.deepEqual(k2PayWords(st('bez_rozpisu', []), TODAY), { words: ['—'], kind: 'none' });
  assert.deepEqual(k2PayWords(null, TODAY), { words: ['—'], kind: 'none' });
  assert.equal(k2PayWords(st('historie', I2), TODAY).kind, 'none');
  assert.equal(k2PayWords(st('storno', []), TODAY).kind, 'none');
});
await t('po splatnosti JEN s příznakem overdue, na první nekryté splátce po termínu', () => {
  const late = [{ amount: 1, due: '2026-04-08', paid: 0, remaining: 1 }, { amount: 1, due: '2027-02-20', paid: 0, remaining: 1 }];
  assert.deepEqual(k2PayWords(st('castecne_1', late, true), TODAY).words, ['částečně (po splatnosti)', 'nezaplaceno']);
  assert.deepEqual(k2PayWords(st('castecne_1', late, false), TODAY).words, ['částečně', 'nezaplaceno']);
  assert.deepEqual(k2PayWords(st('splatka_1_ok', I2, true), TODAY).words, ['zaplaceno', 'nezaplaceno (po splatnosti)']);  // bez splátky po termínu → první nekrytá
});
await t('sloupce podle počtu splátek', () => {
  assert.deepEqual(k2PayColumns(1), ['Platba']);
  assert.deepEqual(k2PayColumns(2), ['1. záloha', 'Doplatek']);
  assert.deepEqual(k2PayColumns(3), ['1. záloha', '2. splátka', 'Doplatek']);
  assert.deepEqual(k2PayColumns(4), ['1. záloha', '2. splátka', '3. splátka', 'Doplatek']);
});

console.log('\n── 2. řazení podle přihlášení ──');
await t('registeredAt → form_p_ mimo dávku → pořadí v poli; dávka 15. 3. ignorována; zrušení ven', () => {
  const batch = 'form_p_' + new Date('2026-03-15T09:32:00').getTime() + '_x';
  const trip = { participants: [
    { id: 'a', name: 'Bez data' },
    { id: 'b', name: 'Reg pozdě', registeredAt: '2026-09-06T22:19:31' },
    { id: 'c', name: 'Reg dřív', registeredAt: '2026-08-19T10:33:33' },
    { id: 'form_p_' + new Date('2026-07-01T12:00:00').getTime() + '_y', name: 'Form červenec' },
    { id: batch, name: 'Migrace' },
    { id: 'z', name: 'Zrušená', isCancelled: true, registeredAt: '2026-01-01T00:00:00' },
  ] };
  const order = k2RegOrder(trip).map(x => x.p.name);
  assert.deepEqual(order, ['Form červenec', 'Reg dřív', 'Reg pozdě', 'Bez data', 'Migrace']);
  assert.equal(k2RegAt(trip.participants[3]).show, false);            // form_p_ jen pro řazení, sloupec prázdný
  assert.equal(k2RegAt(trip.participants[1]).show, true);
  assert.equal(k2RegAt(trip.participants[4]).iso, null);
});

console.log('\n── 3. tabulka pro lektora + OCHRANA ÚDAJŮ ──');
const pii = {
  id: 'p1', name: 'Jana Nová', email: 'jana.tajna@seznam.cz', phone: '+420 777 123 456', birthDate: '15.4.1970',
  city: 'Tajná ulice 12, Litoměřice', nationality: 'ČR', passport: 'RC 7004151234', vs: '2026103007',
  notes: 'POZNAMKA_TAJNA alergie na ořechy', contractSigned: true, registeredAt: '2026-09-06T22:19:31',
  payment1Amount: 13750, schedule: [{ amount: 13750, due: '2026-04-04' }]
};
const tripPii = { id: 't1', name: 'Senegal 2026', date: '14.11. - 22.11.', year: 2026, minPersons: 6, instructor: 'Karolína Tou-Jou',
  participants: [pii, { id: 'p2', name: 'Petr Druhý', email: 'petr.druhy@x.cz', phone: '606606606', contractSigned: false }] };
const statusOf = (trip, p) => p.id === 'p1' ? st('splatka_1_ok', I2) : st('zaplaceno', [{ amount: 27500, due: '2026-05-01', paid: 27500, remaining: 0 }]);
await t('v HTML nejsou žádné osobní údaje ani částky — hodnoty ani názvy polí', () => {
  const tbl = k2BuildLectorTable(tripPii, statusOf, TODAY);
  const body = k2LectorBody(tripPii, tbl, '14. 10. 2026');
  const forbidden = ['jana.tajna', 'seznam.cz', 'petr.druhy', '777 123', '606606606', '1970', 'Tajná ulice', 'Litoměřice', 'RC 7004', '7004151234',
    '2026103007', 'POZNAMKA_TAJNA', 'alergie', '13750', '13 750', '27500', '27 500', 'Kč', 'CZK',
    'email', 'phone', 'birthDate', 'passport', 'vs=', 'notes', 'city', 'nationality', 'amount', 'payment1', 'title='];
  for (const f of forbidden) assert.ok(!body.includes(f), 'uniklo: ' + f);
  assert.ok(body.includes('Jana Nová') && body.includes('Petr Druhý'));
  assert.ok(!body.includes('Tým Essence for Life'), 'podpis doplní worker — v těle nesmí být podruhé');
});
await t('obsah tabulky: pořadí, datum, smlouva, stavy, souhrn', () => {
  const tbl = k2BuildLectorTable(tripPii, statusOf, TODAY);
  assert.deepEqual(tbl.cols, ['1. záloha', 'Doplatek']);
  assert.ok(tbl.html.indexOf('Jana Nová') < tbl.html.indexOf('Petr Druhý'));            // registeredAt před bez data
  assert.ok(tbl.html.includes('<td>6. 9. 2026</td>') && tbl.html.includes('<td>✓ podepsána</td>'));
  assert.ok(tbl.html.includes('<td>zaplaceno</td><td>nezaplaceno</td>'));
  assert.ok(tbl.html.includes('<td>zaplaceno (jednorázová platba)</td><td>—</td>'));      // 1 splátka na 2sloupcové cestě
  assert.deepEqual(tbl.summary, { total: 2, signed: 1, firstPaid: 2, fullyPaid: 1, minPersons: 6, singlePay: false });
  const sum = k2LectorSummaryHtml(tbl.summary);
  assert.ok(sum.includes('Přihlášeno celkem: <strong>2</strong>') && sum.includes('Smlouva podepsána: 1 z 2') && sum.includes('1. záloha zaplacena: 2 z 2') && sum.includes('Plně zaplaceno: 1 z 2') && sum.includes('Minimální počet osob: 6'));
});
await t('bez ledgeru: samé „—", souhrn plateb 0', () => {
  const tbl = k2BuildLectorTable(tripPii, null, TODAY);
  assert.deepEqual(tbl.cols, ['Platba']);
  assert.ok(tbl.html.includes('<td>—</td>'));
  assert.equal(tbl.summary.firstPaid, 0); assert.equal(tbl.summary.fullyPaid, 0); assert.equal(tbl.summary.singlePay, true);
});
await t('tabulka přežije sanitizer (worker i app whitelist s table)', () => {
  const tbl = k2BuildLectorTable(tripPii, statusOf, TODAY);
  const clean = k2SanitizeHtml(tbl.html);
  assert.equal(clean, tbl.html);                                                        // bez atributů → beze změny
  assert.ok(k2HtmlToText(clean).includes('| Jana Nová |'));
  assert.equal(k2CountMarkers(k2LectorBody(tripPii, tbl, 'x')), 0);
});
await t('jména v tabulce jsou escapovaná', () => {
  const tr = { id: 't', name: 'X', participants: [{ id: 'a', name: '<img src=x onerror=alert(1)>' }] };
  const h = k2BuildLectorTable(tr, null, TODAY).html;
  assert.ok(!h.includes('<img') && h.includes('&lt;img'));
});

console.log('\n── 4. lektor ↔ cesta ──');
await t('fuzzy shoda = port z aplikace/workeru', () => {
  assert.ok(k2InstructorMatches('Karolína Tou-Jou', 'Karolína Tou-Jou'));
  assert.ok(k2InstructorMatches('Bečičková', 'Dana Bečičková'));
  assert.ok(!k2InstructorMatches('Karolína Tou-Jou', 'Dana Bečičková'));
  assert.ok(!k2InstructorMatches('', 'Dana Bečičková'));
  G.getInstructors = () => [{ name: 'Karolína Tou-Jou', email: 'k@l.cz' }, { name: 'Dana Bečičková' }];
  assert.deepEqual(k2FindInstructors({ instructor: 'Karolína Tou-Jou' }).map(i => i.email), ['k@l.cz']);
  assert.equal(k2FindInstructors({ instructor: 'Nikdo Neznámý' }).length, 0);
});
await t('email regex odmítá CR/LF a prázdno', () => {
  assert.ok(K2_EMAIL_RE.test('lektor@x.cz'));
  assert.ok(!K2_EMAIL_RE.test('a@b.cz\r\nBcc: z@z.cz') && !K2_EMAIL_RE.test('') && !K2_EMAIL_RE.test('bez-zavinace'));
});

console.log('\n── 5. karta Odeslané emaily ──');
const rec = (o) => Object.assign({ v: 1, id: 'id1', type: 'predodlet', tripId: 't1', tripName: 'Senegal 2026', createdAt: '2026-10-14T09:00:00', by: 'Adela',
  subject: 'Předodletové informace — Senegal', bodyHtml: '<p>x</p>', status: 'sent',
  recipients: [{ email: 'a@x.cz', participantIds: ['p1', 'p2'], names: ['A', 'B'] }, { email: 'c@x.cz', participantIds: ['p3'], names: ['C'] }],
  results: [{ email: 'a@x.cz', ok: true, at: '2026-10-14T09:07:00' }, { email: 'c@x.cz', ok: true, at: '2026-10-14T09:07:03' }] }, o);
await t('čas = poslední úspěšné odeslání, u fronty čas zařazení', () => {
  assert.equal(k2LogWhen(rec()), '2026-10-14T09:07:03');
  assert.equal(k2LogWhen(rec({ status: 'queued', results: [] })), '2026-10-14T09:00:00');
  assert.equal(k2FmtDateTime('2026-10-14T09:07:03'), '14. 10. 2026 09:07');
});
await t('tabulka logu: sloupce, počet osob, štítky, filtr, prázdný stav', () => {
  const trip = { id: 't1', name: 'Senegal 2026' };
  G._k2LogFilter = 'all';
  const c = { recs: [rec(), rec({ id: 'id2', type: 'lektor', status: 'queued', results: [], recipients: [{ email: 'l@x.cz', emailOverride: true }], subject: 'Přehled' })], error: null, years: null };
  let h = k2LogCardHtml(trip, c);
  assert.ok(h.includes('3 příjemců') && h.includes('Adela') && h.includes('Předodletové info') && h.includes('✓ odesláno'));
  assert.ok(h.includes('Přehled lektorovi') && h.includes('l@x.cz') && h.includes('ručně') && h.includes('⏳ ve frontě'));
  assert.ok(h.includes('Zobrazit starší roky') && h.includes('A, B') );
  G._k2LogFilter = 'lektor';
  h = k2LogCardHtml(trip, c);
  assert.ok(h.includes('Přehled lektorovi') && !h.includes('3 příjemců'));
  G._k2LogFilter = 'all';
  h = k2LogCardHtml(trip, { recs: [], error: 'list_500', years: [2026, 2027] });
  assert.ok(h.includes('zatím nic neodešlo') && h.includes('list_500') && !h.includes('Zobrazit starší roky'));
});
await t('dry-run a TEST záznamy označené', () => {
  const h = k2LogCardHtml({ id: 't1', name: 'S' }, { recs: [rec({ status: 'dry', testRedirect: 'honza@x.cz' })], error: null });
  assert.ok(h.includes('dry-run') && h.includes('TEST'));
});

console.log('\n── 6. tlačítka / oprávnění ──');
await t('obě tlačítka bez admin-only; lektor přítomen', () => {
  const b = k2Btns({ id: 't1', status: 'storno' });
  assert.ok(b.includes('k2OpenPredodlet') && b.includes('k2OpenLektor') && !b.includes('admin-only'));
});
await t('v bloku BĚH 4 žádná role/ledgerPerm; sanitizer whitelist obsahuje table', () => {
  const blk = src.slice(src.indexOf('PŘEHLED PRO LEKTORA + KARTA'), src.indexOf('UPOMÍNKY (APP-K1)'));
  assert.ok(!blk.includes('isAdmin(') && !blk.includes('ledgerPerm(') && !blk.includes('isColleague('));
  for (const tg of ['table', 'thead', 'tbody', 'tr', 'th', 'td']) assert.ok(K2_ALLOWED_TAGS.has(tg), tg);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
