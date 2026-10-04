// README용 스크린샷: 별도 헤드리스 크롬(임시 프로필)에 예시 데이터를 넣고 찍는다.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
const SRC = readFileSync('gcal_test.mjs', 'utf8');
const FAKE = eval('`' + SRC.slice(SRC.indexOf('const FAKE = `') + 14, SRC.indexOf('})();`;') + 5) + '`').replaceAll('me@gmail.com', 'damda.demo@gmail.com');
const FAKE_DRIVE = `(() => { const f = window.fetch; window.fetch = async (url, opt = {}) => { const u = String(url); if (!u.includes('/drive/v3/')) return f(url, opt); const J = o => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }); const v = localStorage.getItem('__fv'); const meta = { id: 'f1', version: v || '1', modifiedTime: new Date().toISOString() }; if (u.includes('/files?spaces')) return J({ files: v ? [meta] : [] }); if (u.includes('alt=media')) return J({ version: 1 }); if ((opt.method || 'GET') !== 'GET') { const n = String(Number(v || 0) + 1); localStorage.setItem('__fv', n); return J({ ...meta, version: n }); } return J(meta); }; })();`;
const OUT = 'C:/Users/User/ple/docs/images/';
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const target = await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
const shot = async name => { await sleep(700); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(OUT + name, Buffer.from(r.result.data, 'base64')); console.log('saved', name); };
const size = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
const load = async (url, theme = 'light') => {
  await send('Page.navigate', { url }); await sleep(1200);
  await ev(`localStorage.setItem('ple-theme', '"${theme}"')`);
  await send('Page.reload'); await sleep(3500);
};

const SEED = `
  localStorage.clear();
  await new Promise(r => { const q = indexedDB.deleteDatabase('damda'); q.onsuccess = q.onerror = q.onblocked = r; });
  localStorage.setItem('ple-google', JSON.stringify({ email: 'damda.demo@gmail.com' }));
  localStorage.setItem('ple-sync-mode', '"auto"');
  localStorage.setItem('ple-gscopes', JSON.stringify(['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events']));
  localStorage.setItem('ple-gtoken', JSON.stringify({ token: 'fakeMain', exp: Date.now() + 3600e3, scope: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events' }));
  const cat = await import('/js/categories.js');
  const rec = await import('/js/recurring.js');
  const tr = await import('/js/taskRepeat.js');
  const { store } = await import('/js/store.js');
  const u = await import('/js/utils.js');
  const T = (k, n, s) => cat.addCategory(k, n, { slot: s }).id;
  const health = T('task', '건강', 2), study = T('task', '공부', 1), home = T('task', '집안일', 4), work = T('task', '회사', 6);
  const food = T('ledger', '식비', 3), cafe = T('ledger', '카페', 5), trans = T('ledger', '교통', 1), shop = T('ledger', '쇼핑', 7);
  const salary = T('ledger', '월급', 2), phone = T('ledger', '통신비', 6), rent = T('ledger', '월세', 8), elec = T('ledger', '공과금', 4);
  const today = u.todayKey();
  const d0 = u.keyToDate(today);
  const key = off => { const d = new Date(d0); d.setDate(d.getDate() + off); return u.toKey(d.getFullYear(), d.getMonth(), d.getDate()); };
  // 고정 수입·지출 (8월부터)
  for (const r of [
    { type: 'income', category: salary, memo: '월급', amount: 2800000, day: 25 },
    { type: 'expense', category: rent, memo: '월세', amount: 550000, day: 1 },
    { type: 'expense', category: phone, memo: '휴대폰 요금', amount: 55000, day: 20 },
  ]) { const s = rec.saveRule(r, { includeThisMonth: true }); store.put('recurring', { id: s.id, startMonth: '2026-08' }); }
  rec.saveRule({ type: 'expense', category: elec, memo: '전기요금', amount: 0, askAmount: true, day: 15 }, { includeThisMonth: true });
  rec.runRecurring();
  // 매일 지출 (지난달 1일 ~ 오늘)
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const start = new Date(d0.getFullYear(), d0.getMonth() - 1, 1);
  store.batch(() => {
    for (let d = new Date(start); d <= d0; d.setDate(d.getDate() + 1)) {
      const k = u.toKey(d.getFullYear(), d.getMonth(), d.getDate());
      const wd = d.getDay();
      store.put('expenses', { date: k, type: 'expense', category: food, amount: Math.round((7000 + rnd() * 9000) / 100) * 100, memo: ['김밥', '국밥', '떡볶이', '도시락', '샐러드'][Math.floor(rnd() * 5)] });
      if (rnd() > 0.45) store.put('expenses', { date: k, type: 'expense', category: cafe, amount: [4500, 5000, 6300][Math.floor(rnd() * 3)], memo: '커피' });
      if (wd > 0 && wd < 6) store.put('expenses', { date: k, type: 'expense', category: trans, amount: 2900, memo: '버스' });
      if (rnd() > 0.88) store.put('expenses', { date: k, type: 'expense', category: shop, amount: Math.round((15000 + rnd() * 50000) / 1000) * 1000, memo: ['운동화', '책', '생활용품'][Math.floor(rnd() * 3)] });
    }
  });
  // 일정
  store.put('events', { title: '친구 생일', start: key(6), end: key(6), time: '', color: '#e8708a' });
  store.put('events', { title: '가족 여행', start: key(13), end: key(15), time: '', color: '#3fb27f' });
  store.put('events', { title: '발표 준비', start: key(20), end: key(20), time: '', color: '#f0a33a' });
  // 반복 할 일 + 지난 날 체크
  tr.saveTaskRule({ title: '약 먹기', type: 'daily', times: ['아침', '저녁'], category: health, startDate: key(-9) });
  tr.saveTaskRule({ title: '물 2L 마시기', type: 'daily', times: [''], category: health, startDate: key(-6) });
  for (let off = -9; off <= 0; off++) for (const t of tr.tasksOn(key(off))) if (t.ruleId && !(off === 0 && (t.title.includes('물') || t.slot === 1))) tr.setTaskDone(t, true);
  // 일반 할 일
  const add = (off, title, category, done) => store.put('tasks', { date: key(off), title, category, done });
  add(0, '장보기', home, true); add(0, '보고서 정리', work, true); add(0, '영어 단어 30개', study, false); add(0, '방 청소', home, false);
  for (let off = -3; off < 0; off++) { add(off, '운동 30분', health, true); add(off, '독서', study, off !== -2); }
  add(2, '분리수거', home, false); add(5, '회의 자료', work, false);
  return 'seeded';
`;

await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true }); await send('Network.setBypassServiceWorker', { bypass: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_DRIVE });
// 1. PC 캘린더 + 날짜 패널
await size(1280, 800, false);
await send('Page.navigate', { url: 'http://localhost:5500/' }); await sleep(1500);
console.log(await ev(SEED));
await load('http://localhost:5500/?tab=calendar');
await ev(`document.querySelector('.cell.today').click()`);
await shot('01-calendar.png');

// 2. 모바일 할 일
await size(390, 844, true);
await load('http://localhost:5500/?tab=tasks');
await shot('02-tasks.png');

// 3. 모바일 가계부 (지난달 전체)
await load('http://localhost:5500/?tab=ledger');
await ev(`document.querySelector('[data-period="-1"]').click()`);
await shot('03-ledger.png');
await ev(`document.querySelector('[data-period="1"]').click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('.rule-card').scrollIntoView({ block: 'center' })`);
await shot('04-recurring.png');

// 5. 사용 가이드
await load('http://localhost:5500/?tab=tasks');
await ev(`document.querySelector('#helpBtn').click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('[data-step="1"]').click()`);
await shot('05-guide.png');

// 6. 메뉴 (동기화·설정)
await load('http://localhost:5500/?tab=calendar');
await ev(`document.querySelector('#menuBtn').click(); await new Promise(r => setTimeout(r, 400)); document.querySelector('#menuModal .modal-box').scrollTop = document.querySelector('.gcal-slot').offsetTop - 60`);
await shot('06-menu.png');

// 7. 금액 숨기기 (모바일 캘린더, 켜짐/꺼짐)
await load('http://localhost:5500/?tab=calendar');
await shot('07-money-on.png');
await ev(`document.querySelector('[data-act="money"]').click(); await new Promise(r => setTimeout(r, 2600))`);
await shot('08-money-off.png');
await ev(`document.querySelector('[data-act="money"]').click()`);

// 10. 일정 고치기 창 (모바일)
await load('http://localhost:5500/?tab=calendar');
await ev(`document.querySelector('.cell.today').click(); await new Promise(r => setTimeout(r, 600)); const row = [...document.querySelectorAll('#dayPanel .event.editable')].find(x => x.innerText.includes('병원')); row?.click()`);
await shot('10-event-edit.png');

// 9. 어두운 화면 (PC)
await size(1280, 800, false);
await load('http://localhost:5500/?tab=ledger', 'dark');
await shot('09-dark.png');

ws.close(); process.exit(0);
