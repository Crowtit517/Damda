import { readFileSync } from 'node:fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const src = readFileSync('gcal_test.mjs', 'utf8');
const FAKE = eval('`' + src.slice(src.indexOf('const FAKE = `') + 14, src.indexOf('})();`;') + 5) + '`');
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  (' + String(x).slice(0, 200) + ')' : ''}`);
const t = await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? ('ERR ' + JSON.stringify(r.result?.exceptionDetails).slice(0, 300)); };
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
await send('Page.navigate', { url: 'http://localhost:5500/' }); await sleep(1500);
const S = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
// 이미 구글 계정만 연결된 기기 (캘린더 켜짐 기록 없음) + 담다에만 있는 일정 2개
await ev(`localStorage.clear(); localStorage.removeItem('__fakecal'); await new Promise(r => { const q = indexedDB.deleteDatabase('damda'); q.onsuccess = q.onerror = q.onblocked = r; });
  localStorage.setItem('ple-google', JSON.stringify({ email: 'me@gmail.com' })); localStorage.setItem('ple-sync-mode', '"local"');
  localStorage.setItem('ple-gtoken', JSON.stringify({ token: 'fakeMain', exp: Date.now() + 3600e3, scope: '${S}' })); return 1`);
await send('Page.reload'); await sleep(1800);
await ev(`const { store } = await import('/js/store.js'); const p = n => String(n).padStart(2, '0'); const T = new Date(); const K = T.getFullYear() + '-' + p(T.getMonth() + 1) + '-' + p(T.getDate()); store.put('events', { title: '예전 일정 A', start: K, end: K, time: '', color: '#ff8fa8' }); store.put('events', { title: '예전 일정 B', start: K, end: K, time: '09:00', color: '#7fa8ff' }); return 1`);
await send('Page.reload'); await sleep(2500);
let r = await ev(`const g = await import('/js/sync/gcal.js'); const go = await import('/js/sync/google.js'); await g.refresh(); return { on: g.isEnabled(), wanted: localStorage.getItem('ple-gscopes'), phase: g.getStatus().phase, canWrite: g.canWrite() }`);
ok('구글 계정이 연결돼 있으면 캘린더가 자동으로 켜짐 (따로 연결 안 해도)', r.on && r.phase === 'ok' && r.canWrite, JSON.stringify(r));
ok('다음 로그인 때 캘린더 권한도 함께 요청하도록 준비됨', (r.wanted || '').includes('calendar.events'));
r = await ev(`await new Promise(r => setTimeout(r, 1200)); const { store } = await import('/js/store.js'); const db = __fakeDb(); document.getElementById('menuBtn').click(); await new Promise(r => setTimeout(r, 400)); return { moved: db.events['me@gmail.com'].filter(e => e.summary.startsWith('예전 일정')).length, left: store.list('events').length, ids: db.events['me@gmail.com'].filter(e => e.summary.startsWith('예전 일정')).map(e => e.id).join(','), dialog: document.getElementById('dialogModal').classList.contains('open'), btn: !!document.querySelector('[data-act="gcal-migrate"]') }`);
ok('버튼·질문 없이 담다 일정 2개가 저절로 구글로 옮겨지고 사본은 지워짐', r.moved === 2 && r.left === 0 && !r.dialog && !r.btn, JSON.stringify(r));
// 다른 기기가 같은 일정을 또 옮기는 상황: 같은 아이디의 담다 일정을 되살려 다시 옮기게 한다
r = await ev(`const { store } = await import('/js/store.js'); const g = await import('/js/sync/gcal.js'); const old = store.all('events'); store.batch(() => old.forEach(e => store.restore('events', e.id))); await g.refresh(); await new Promise(r => setTimeout(r, 1500)); const db = __fakeDb(); return { google: db.events['me@gmail.com'].filter(e => e.summary.startsWith('예전 일정')).length, left: store.list('events').length }`);
ok('두 기기가 같은 일정을 옮겨도 구글에는 하나씩만 (중복 없음)', r.google === 2 && r.left === 0, JSON.stringify(r));
// 직접 끄면 계속 꺼져 있음
r = await ev(`const g = await import('/js/sync/gcal.js'); await g.disconnectCalendar(); return 1`);
await send('Page.reload'); await sleep(1500);
r = await ev(`const g = await import('/js/sync/gcal.js'); return { on: g.isEnabled() }`);
ok('캘린더 연결을 직접 끄면 다시 열어도 꺼진 채로', r.on === false, JSON.stringify(r));
ok('페이지 오류 없음', errors.length === 0, errors.join(' | '));
console.log(out.join('\n')); ws.close(); process.exit(0);
