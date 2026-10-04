// 구글 캘린더 양방향 동기화 검증: 가짜 구글 캘린더 서버(페이지 안 fetch 가로채기)로 시험한다.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + String(extra).slice(0, 160) + ')' : ''}`);

const FAKE = `
(() => {
  const realFetch = window.fetch.bind(window);
  const LS = '__fakecal';
  const p = n => String(n).padStart(2, '0');
  const t = new Date();
  const d = dd => t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(dd);
  const today = t.getDate();
  const init = () => ({
    fail: 0,
    tokens: { fakeMain: 'me@gmail.com', fakeExtra: 'work@company.com' },
    lists: {
      'me@gmail.com': [
        { id: 'me@gmail.com', summary: 'me@gmail.com', backgroundColor: '#039be5', primary: true, selected: true, accessRole: 'owner' },
        { id: 'family', summary: '가족', backgroundColor: '#e67c73', selected: true, accessRole: 'writer' },
        { id: 'holiday', summary: '대한민국의 휴일', backgroundColor: '#0b8043', selected: true, accessRole: 'reader' },
      ],
      'work@company.com': [ { id: 'work@company.com', summary: '회사', backgroundColor: '#f6bf26', primary: true, selected: true, accessRole: 'owner' } ],
    },
    events: {
      'me@gmail.com': [
        { id: 'e1', etag: '"1"', summary: '병원 예약', start: { dateTime: d(today) + 'T14:00:00+09:00' }, end: { dateTime: d(today) + 'T15:00:00+09:00' }, htmlLink: 'https://www.google.com/calendar/event?eid=e1' },
        { id: 'r1_1', etag: '"1"', summary: '매주 회의', recurringEventId: 'r1', start: { dateTime: d(today) + 'T09:00:00+09:00' }, end: { dateTime: d(today) + 'T09:30:00+09:00' } },
      ],
      family: [], holiday: [ { id: 'h1', etag: '"1"', summary: '한글날', start: { date: d(9) }, end: { date: d(10) } } ],
      'work@company.com': [ { id: 'w1', etag: '"1"', summary: '회사 회의', start: { dateTime: d(today) + 'T11:00:00+09:00' }, end: { dateTime: d(today) + 'T12:00:00+09:00' } } ],
    },
    log: [],
  });
  const load = () => { try { return JSON.parse(localStorage.getItem(LS)) || init(); } catch { return init(); } };
  const save = db => localStorage.setItem(LS, JSON.stringify(db));
  window.__fakeDb = () => load();
  window.__fakeSet = fn => { const db = load(); fn(db); save(db); };
  const ms = x => x.dateTime ? Date.parse(x.dateTime) : Date.parse(x.date + 'T00:00:00');
  window.fetch = async (url, opt = {}) => {
    const u = new URL(String(url), location.href);
    if (!u.pathname.startsWith('/calendar/v3/')) return realFetch(url, opt);
    const db = load();
    if (db.fail > 0) { db.fail--; save(db); throw new TypeError('fake network down'); }
    const token = (opt.headers?.Authorization || '').replace('Bearer ', '');
    const who = db.tokens[token];
    const J = (o, status = 200) => new Response(o === null ? null : JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (!who) return J({ error: { code: 401 } }, 401);
    const method = (opt.method || 'GET').toUpperCase();
    const path = decodeURIComponent(u.pathname.replace('/calendar/v3', ''));
    db.log.push(method + ' ' + path); save(db);
    if (path === '/users/me/calendarList') return J({ items: db.lists[who] || [] });
    if (path === '/calendars/primary') return J({ id: who });
    const m = path.match(/^\\/calendars\\/([^/]+)\\/events(?:\\/(.+))?$/);
    if (!m) return J({ error: {} }, 404);
    const cal = m[1], id = m[2];
    if (!(db.lists[who] || []).some(c => c.id === cal)) return J({ error: { errors: [{ reason: 'forbidden' }] } }, 403);
    const list = (db.events[cal] ||= []);
    if (method === 'GET' && !id) {
      const tmin = Date.parse(u.searchParams.get('timeMin')), tmax = Date.parse(u.searchParams.get('timeMax'));
      return J({ items: list.filter(e => ms(e.start) < tmax && ms(e.end) > tmin) });
    }
    const ev = list.find(e => e.id === id);
    if (method === 'GET') return ev ? J(ev) : J({ error: {} }, 404);
    if (method === 'POST') {
      const body = JSON.parse(opt.body);
      if (list.some(e => e.id === body.id)) return J({ error: { code: 409 } }, 409);
      const n = { ...body, etag: '"1"', htmlLink: 'https://www.google.com/calendar/event?eid=' + body.id };
      if (n.colorId === null) delete n.colorId;
      list.push(n); save(db); return J(n);
    }
    if (method === 'PATCH') {
      if (!ev) return J({ error: {} }, 404);
      if (opt.headers['If-Match'] && opt.headers['If-Match'] !== ev.etag) return J({ error: { code: 412 } }, 412);
      const body = JSON.parse(opt.body);
      Object.assign(ev, body); if (ev.colorId === null) delete ev.colorId;
      ev.etag = '"' + (Number(ev.etag.replace(/"/g, '')) + 1) + '"';
      save(db); return J(ev);
    }
    if (method === 'DELETE') {
      if (!ev) return J(null, 410);
      db.events[cal] = list.filter(e => e.id !== id); save(db); return new Response(null, { status: 204 });
    }
    return J({ error: {} }, 400);
  };
})();`;

const t = await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400);
  return r.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
{ // 가짜 드라이브·로그인 창 (menu_test.mjs와 같은 것)
  const { readFileSync } = await import('node:fs');
  const M = readFileSync('menu_test.mjs', 'utf8');
  const raw = M.slice(M.indexOf('const FAKE_DRIVE_GIS = `') + 24, M.indexOf('})();`;', M.indexOf('const FAKE_DRIVE_GIS')) + 5);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: eval('`' + raw + '`') });
}
const reload = async (ms = 2200) => { await send('Page.reload'); await sleep(ms); };

await send('Page.navigate', { url: 'http://localhost:5500/' }); await sleep(1500);
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
await ev(`localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('damda'); q.onsuccess = q.onerror = q.onblocked = r; });
  localStorage.setItem('ple-google', JSON.stringify({ email: 'me@gmail.com' }));
  localStorage.setItem('ple-sync-mode', '"local"');
  localStorage.setItem('ple-gcal-on', 'true');
  localStorage.setItem('ple-gscopes', JSON.stringify(['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events']));
  localStorage.setItem('ple-gtoken', JSON.stringify({ token: 'fakeMain', exp: Date.now() + 3600e3, scope: '${SCOPES}' }));
  return 1`);
await reload();
const G = `const g = await import('/js/sync/gcal.js'); const p = n => String(n).padStart(2, '0'); const T = new Date(); const K = T.getFullYear() + '-' + p(T.getMonth() + 1) + '-' + p(T.getDate());`;

// 1. 읽기
let r = await ev(`${G} await g.refresh(); return { phase: g.getStatus().phase, cals: g.calendars().map(c => c.name + (c.writable ? '' : '(보기만)')).join(', '), today: g.eventsOn(K).map(e => e.title + (e.writable ? '' : '(보기만)')).join(', '), target: g.target()?.name }`);
ok('구글 캘린더 읽기 (캘린더 3개, 오늘 일정, 반복 일정은 보기만)', r.phase === 'ok' && r.cals.includes('대한민국의 휴일(보기만)') && r.today.includes('병원 예약') && r.today.includes('매주 회의(보기만)'), JSON.stringify(r));
ok('새 일정 기본 저장 위치 = 기본 캘린더', r.target === 'me@gmail.com', r.target);

// 2. 날짜 패널에서 일정 추가 → 구글에 생김
await ev(`document.querySelector('.cell.today').click(); await new Promise(r => setTimeout(r, 500));
  const add = document.querySelector('#dayPanel .event-add'); add.open = true;
  const f = add.querySelector('.event-form'); f.title.value = '담다에서 만든 일정'; f.time.value = '18:00'; f.time.dispatchEvent(new Event('input', { bubbles: true }));
  f.querySelector('[name=reminder]').value = '30';
  f.requestSubmit(); await new Promise(r => setTimeout(r, 900)); return 1`);
r = await ev(`${G} const db = __fakeDb(); const made = db.events['me@gmail.com'].filter(e => e.summary === '담다에서 만든 일정'); const shown = g.eventsOn(K).find(e => e.title === '담다에서 만든 일정'); return { count: made.length, id: made[0]?.id, rem: JSON.stringify(made[0]?.reminders), end: made[0]?.end?.dateTime, pending: shown?.pending, row: !!document.querySelector('#dayPanel .event.editable') }`);
ok('담다에서 추가 → 구글 캘린더에 1개 생성', r.count === 1 && /^damda[0-9a-v]+$/.test(r.id || ''), JSON.stringify(r));
ok('알림(30분 전)·끝 시간(+1시간)도 함께 저장', r.rem.includes('"minutes":30') && (r.end || '').includes('T19:00'), r.rem + ' ' + r.end);
ok('보낸 뒤 "올리는 중" 표시 사라짐', r.pending !== true);

// 3. 인터넷이 끊겼을 때 추가 → 다시 연결되면 한 번만 생성
await ev(`__fakeSet(db => { db.fail = 1; }); const g = await import('/js/sync/gcal.js'); await g.createEvent({ title: '오프라인 일정', start: '${new Date().toLocaleDateString('sv-SE')}', end: '${new Date().toLocaleDateString('sv-SE')}', time: '', reminder: 'default' }); await new Promise(r => setTimeout(r, 600)); return 1`);
r = await ev(`${G} return { outbox: g.getStatus().outbox, shownWhileOffline: g.eventsOn(K).some(e => e.title === '오프라인 일정' && e.pending) }`);
ok('인터넷이 끊겨도 화면에는 바로 보이고 보낼 목록에 남음', r.outbox === 1 && r.shownWhileOffline, JSON.stringify(r));
await reload();
r = await ev(`${G} await g.refresh(); await new Promise(r => setTimeout(r, 600)); const db = __fakeDb(); return { made: db.events['me@gmail.com'].filter(e => e.summary === '오프라인 일정').length, outbox: g.getStatus().outbox }`);
ok('다시 열면 보낼 목록을 보내서 정확히 1개 생성 (새로고침 후에도)', r.made === 1 && r.outbox === 0, JSON.stringify(r));

// 4. 고치기 창에서 수정 → 구글 반영
await ev(`document.querySelector('.cell.today').click(); await new Promise(r => setTimeout(r, 500));
  const row = [...document.querySelectorAll('#dayPanel .event.editable')].find(x => x.innerText.includes('병원 예약')); row.click(); await new Promise(r => setTimeout(r, 400));
  const f = document.querySelector('#eventModal .event-form'); f.title.value = '병원 예약 (치과)'; f.requestSubmit(); await new Promise(r => setTimeout(r, 900)); return 1`);
r = await ev(`const e1 = __fakeDb().events['me@gmail.com'].find(e => e.id === 'e1'); return { title: e1.summary, etag: e1.etag }`);
ok('담다에서 수정 → 구글 일정 제목 바뀜 (버전 2)', r.title === '병원 예약 (치과)' && r.etag === '"2"', JSON.stringify(r));

// 5. 다른 곳에서 먼저 고친 일정 → 덮어쓰지 않음
await ev(`__fakeSet(db => { const e = db.events['me@gmail.com'].find(x => x.id === 'e1'); e.summary = '폰에서 고친 제목'; e.etag = '"9"'; }); return 1`);
r = await ev(`${G} const e = g.eventsOn(K).find(x => x.gid === 'e1'); let msg = ''; window.addEventListener('ple:gcal-notice', ev => { msg = ev.detail; }); await g.updateEvent(e, { title: '담다에서 늦게 고친 제목', start: e.start, end: e.end, time: e.time, endTime: e.endTime, reminder: 'default' }); await new Promise(r => setTimeout(r, 900)); const server = __fakeDb().events['me@gmail.com'].find(x => x.id === 'e1').summary; const shown = g.eventsOn(K).find(x => x.gid === 'e1').title; return { server, shown, msg }`);
ok('충돌 시 폰에서 고친 내용을 덮어쓰지 않고 최신으로 다시 불러옴', r.server === '폰에서 고친 제목' && r.shown === '폰에서 고친 제목' && r.msg.includes('다른 곳에서'), JSON.stringify(r));

// 6. 지우기 + 되돌리기
r = await ev(`${G} const e = g.eventsOn(K).find(x => x.title === '담다에서 만든 일정'); const undo = g.deleteEvent(e); const hidden = !g.eventsOn(K).some(x => x.id === e.id); undo(); await new Promise(r => setTimeout(r, 300)); const back = g.eventsOn(K).some(x => x.id === e.id); return { hidden, back, still: __fakeDb().events['me@gmail.com'].some(x => x.summary === '담다에서 만든 일정') }`);
ok('지우면 바로 숨고, 되돌리면 다시 보이며 구글에서는 안 지워짐', r.hidden && r.back && r.still, JSON.stringify(r));
r = await ev(`${G} const e = g.eventsOn(K).find(x => x.title === '담다에서 만든 일정'); g.deleteEvent(e); await new Promise(r => setTimeout(r, 9000)); return { gone: !__fakeDb().events['me@gmail.com'].some(x => x.summary === '담다에서 만든 일정') }`);
ok('8초 뒤 구글 캘린더에서도 지워짐', r.gone, JSON.stringify(r));

// 7. 보기만 일정: 지우기 버튼 없음, 눌러도 고치기 창 안 열림
await reload();
r = await ev(`document.querySelector('.cell.today').click(); await new Promise(r => setTimeout(r, 500)); const row = [...document.querySelectorAll('#dayPanel .event')].find(x => x.innerText.includes('매주 회의')); row.click(); await new Promise(r => setTimeout(r, 300)); return { del: !!row.querySelector('.del-btn'), modal: document.getElementById('eventModal').classList.contains('open'), label: row.innerText.includes('보기만') }`);
ok('반복 일정은 보기만 (지우기·고치기 없음)', !r.del && !r.modal && r.label, JSON.stringify(r));

// 8. 다른 구글 계정 추가
await ev(`const x = { 'work@company.com': { token: 'fakeExtra', exp: Date.now() + 3600e3, scope: '${SCOPES}' } }; localStorage.setItem('ple-gcal-extra', JSON.stringify(x)); return 1`);
await reload();
r = await ev(`${G} await g.refresh(); return { accts: g.accounts().map(a => a.email).join(', '), work: g.eventsOn(K).some(e => e.title === '회사 회의'), writable: g.writableCalendars().map(c => c.name).join(', ') }`);
ok('두 번째 구글 계정의 캘린더와 일정도 보임', r.accts.includes('work@company.com') && r.work, JSON.stringify(r));
r = await ev(`${G} g.setTarget('work@company.com', 'work@company.com'); await g.createEvent({ title: '회사 캘린더에 저장', start: K, end: K, time: '10:00', reminder: 'default' }); await new Promise(r => setTimeout(r, 800)); const db = __fakeDb(); return { work: db.events['work@company.com'].some(e => e.summary === '회사 캘린더에 저장'), main: db.events['me@gmail.com'].some(e => e.summary === '회사 캘린더에 저장') }`);
ok('저장 위치를 바꾸면 그 계정 캘린더에 저장', r.work && !r.main, JSON.stringify(r));
r = await ev(`${G} await g.removeAccount('work@company.com'); return { work: g.eventsOn(K).some(e => e.title === '회사 회의'), accts: g.accounts().length }`);
ok('계정을 빼면 그 계정 일정이 사라짐', !r.work && r.accts === 1, JSON.stringify(r));

// 9. 담다에만 있던 일정 → 저절로 구글로
r = await ev(`${G} const { store } = await import('/js/store.js'); store.put('events', { title: '예전 담다 일정', start: K, end: K, time: '', color: '#5fd3a5' }); await g.refresh(); await new Promise(r => setTimeout(r, 1000)); const db = __fakeDb(); const moved = db.events['me@gmail.com'].find(e => e.summary === '예전 담다 일정'); return { moved: !!moved, color: moved?.colorId, localLeft: store.list('events').length }`);
ok('담다 일정을 저절로 구글로 옮기고 담다 쪽 사본은 지움 (색도 비슷하게)', r.moved && r.localLeft === 0 && !!r.color, JSON.stringify(r));

// 10. 인터넷 없이 다시 열어도 보관한 일정이 보임
await ev(`__fakeSet(db => { db.fail = 99; }); return 1`);
await reload();
r = await ev(`${G} await new Promise(r => setTimeout(r, 500)); return g.eventsOn(K).map(e => e.title).join(', ')`);
ok('인터넷 없이 열어도 보관해 둔 구글 일정이 보임', typeof r === 'string' && r.includes('폰에서 고친 제목'), r);
await ev(`__fakeSet(db => { db.fail = 0; }); return 1`);

ok('페이지 오류 없음', errors.length === 0, errors.join(' | '));
console.log(results.join('\n'));
ws.close();
process.exit(0);
