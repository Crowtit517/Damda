// 메뉴 정리 + 할 일·가계부 담는 곳 검증 (가짜 구글: 캘린더, 계정별 드라이브, 로그인 창)
import { readFileSync } from 'node:fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SRC = readFileSync('gcal_test.mjs', 'utf8');
const FAKE_CAL = eval('`' + SRC.slice(SRC.indexOf('const FAKE = `') + 14, SRC.indexOf('})();`;') + 5) + '`');
const ALL = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
const FAKE_DRIVE_GIS = `
(() => {
  const f = window.fetch;
  const LS = '__fakedrive';
  const load = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
  const save = d => localStorage.setItem(LS, JSON.stringify(d));
  window.__drive = () => load();
  window.__driveSet = fn => { const d = load(); fn(d); save(d); };
  window.fetch = async (url, opt = {}) => {
    const u = String(url);
    if (!u.includes('/drive/v3/')) return f(url, opt);
    const token = (opt.headers?.Authorization || '').replace('Bearer ', '');
    if (!['fakeMain', 'fakeExtra'].includes(token)) return new Response('{}', { status: 401 });
    const J = o => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const d = load(); const box = d[token];
    const meta = box ? { id: 'file-' + token, version: String(box.version), modifiedTime: new Date().toISOString() } : null;
    const method = (opt.method || 'GET').toUpperCase();
    if (method === 'GET' && u.includes('/files?spaces')) return J({ files: meta ? [meta] : [] });
    if (method === 'GET' && u.includes('alt=media')) return J(box.data);
    if (method === 'GET') return box ? J(meta) : new Response('{}', { status: 404 });
    if (method === 'POST') {
      const parts = String(opt.body).split(/\\r\\n\\r\\n/);
      const data = JSON.parse(parts[2].split('\\r\\n--')[0]);
      d[token] = { version: 1, data }; save(d);
      return J({ id: 'file-' + token, version: '1' });
    }
    if (method === 'PATCH') {
      d[token] = { version: (box?.version || 0) + 1, data: JSON.parse(opt.body) }; save(d);
      return J({ id: 'file-' + token, version: String(d[token].version) });
    }
    return new Response('{}', { status: 400 });
  };
  // 가짜 구글 로그인 창: 계정 힌트가 work@company.com 이거나 계정 고르기면 추가 계정 토큰
  window.google = { accounts: { oauth2: {
    initTokenClient: cfg => ({ requestAccessToken: opts => setTimeout(() => {
      const extra = opts.login_hint === 'work@company.com' || opts.prompt === 'select_account';
      cfg.callback({ access_token: extra ? 'fakeExtra' : 'fakeMain', expires_in: 3600, scope: cfg.scope });
    }, 20) }),
    revoke: () => {},
  } } };
})();`;

const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  (' + String(x).slice(0, 220) + ')' : ''}`);
const t = await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? ('ERR ' + JSON.stringify(r.result?.exceptionDetails).slice(0, 300)); };
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true }); await send('Network.setBypassServiceWorker', { bypass: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_CAL });
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_DRIVE_GIS });
const reload = async (ms = 2500) => { await send('Page.reload'); await sleep(ms); };
const openMenu = `document.getElementById('menuBtn').click(); await new Promise(r => setTimeout(r, 500));`;
const openSet = `document.getElementById('menuBtn').click(); await new Promise(r => setTimeout(r, 500)); document.querySelector('[data-act="open-settings"]').click(); await new Promise(r => setTimeout(r, 500));`;
const closeAll = `document.querySelectorAll('.modal.open [data-close]').forEach(b => b.click()); await new Promise(r => setTimeout(r, 400));`;

await send('Page.navigate', { url: 'http://localhost:5500/' }); await sleep(1500);
await ev(`localStorage.clear(); for (const n of ['damda', 'damda:work@company.com']) await new Promise(r => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = r; }); return 1`);
await reload(1800);

// 1. 연결 전
let r = await ev(`${openMenu} return { card: document.querySelector('.sync-slot').innerText.replace(/\\s+/g, ' '), modes: document.querySelectorAll('#menuModal [data-mode]').length, pill: document.getElementById('syncPill').innerText }`);
ok('연결 전: 구글 연결 버튼 + "이 기기에만 저장" 안내, 방식 고르기 없음', r.card.includes('구글 계정으로 연결') && r.card.includes('이 기기에만 저장') && r.modes === 0, JSON.stringify(r));

// 2. 연결 (가짜 로그인 창) → 캘린더도 함께
await ev(`localStorage.setItem('ple-sync-mode', '"manual"'); return 1`); // 예전 '직접' 모드 기기
await reload(1500);
await ev(`${openMenu} document.querySelector('[data-act="google-connect"]').click(); await new Promise(r => setTimeout(r, 2500)); return 1`);
r = await ev(`const s = await import('/js/sync/engine.js'); const g = await import('/js/sync/gcal.js'); return { mode: s.syncMode(), connected: s.isConnected(), cal: g.isEnabled(), phase: g.getStatus().phase, drive: !!__drive().fakeMain, desc: document.querySelector('.sync-desc')?.innerText, saverBtn: !!document.querySelector('[data-act="toggle-saver"]'), now: !!document.querySelector('[data-act="sync-now"]') }`);
ok('연결하면 자동 동기화 + 캘린더도 함께 (예전 "직접" 모드도 자동으로)', r.mode === 'auto' && r.connected && r.cal && r.phase === 'ok' && r.drive, JSON.stringify(r));
ok('자동 동기화 설명 + 절약 모드 스위치, [지금 맞추기]는 숨김', (r.desc || '').includes('1초') && r.saverBtn && !r.now, JSON.stringify(r));
r = await ev(`document.querySelector('[data-act="toggle-saver"]').click(); await new Promise(r => setTimeout(r, 300)); const s = await import('/js/sync/engine.js'); const now = !!document.querySelector('[data-act="sync-now"]'); const desc = document.querySelector('.sync-desc').innerText; document.querySelector('[data-act="toggle-saver"]').click(); await new Promise(r => setTimeout(r, 300)); return { mode: s.syncMode(), now, desc }`);
ok('절약 모드를 켜면 설명이 바뀌고 [지금 맞추기]가 보임, 끄면 자동으로', r.now && r.desc.includes('절약') && r.mode === 'auto', JSON.stringify(r));

// 2-1. 설정 창: 계정이 하나여도 담는 곳 두 개가 보임
r = await ev(`${closeAll} ${openSet} const m = document.getElementById('settingsModal'); return { open: m.classList.contains('open'), text: m.innerText.replace(/\s+/g, ' '), cal: !!m.querySelector('[data-gcal-target]'), place: !!m.querySelector('[data-data-place]'), menuHasSelect: !!document.querySelector('#menuModal select') }`);
ok('☰ → [⚙️ 설정]을 누르면 설정 창이 열리고, 계정이 하나여도 "일정 담는 곳"·"할 일·가계부 담는 곳"이 보임', r.open && r.cal && r.place && r.text.includes('알림') && !r.menuHasSelect, JSON.stringify({ ...r, text: r.text.slice(0, 120) }));
await ev(`${closeAll} return 1`);

// 3. 다른 계정 추가 → 접혀 있다가 ▾로 펼침
await ev(`document.querySelector('[data-act="gcal-add-account"]').click(); await new Promise(r => setTimeout(r, 2000)); return 1`);
await ev(`${closeAll} return 1`);
r = await ev(`${openMenu} const slot = document.querySelector('.gcal-slot'); const toggle = slot.querySelector('[data-act="toggle-accounts"]'); const before = slot.innerText.includes('work@company.com'); return { toggle: toggle?.innerText.replace(/\\s+/g, ' '), before }`);
ok('추가 계정은 접혀 있음 ("다른 계정 1개 ▾")', (r.toggle || '').includes('다른 계정 1개') && !r.before, JSON.stringify(r));
r = await ev(`document.querySelector('[data-act="toggle-accounts"]').click(); await new Promise(r => setTimeout(r, 300)); return document.querySelector('.gcal-slot').innerText.includes('work@company.com')`);
ok('▾를 누르면 추가 계정과 캘린더가 펼쳐짐', r === true);

// 4. 일정 담는 곳: 꺼 둔 캘린더를 고르면 저절로 켜짐
r = await ev(`${closeAll} const g = await import('/js/sync/gcal.js'); g.toggleCalendar('main', 'family'); ${openSet} await new Promise(r => setTimeout(r, 300)); const off = !g.calendars().find(c => c.id === 'family').visible; const sel = document.querySelector('[data-gcal-target]'); sel.value = 'main|family'; sel.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 500)); return { off, label: sel.closest('.set-select').innerText.replace(/\\s+/g, ' ').slice(0, 60), visible: g.calendars().find(c => c.id === 'family').visible, target: g.target().id }`);
ok('일정 담는 곳: 설명 문구, 꺼 둔 캘린더를 고르면 저절로 켜짐', r.off && r.visible && r.target === 'family' && r.label.includes('캘린더를 정하는 곳'), JSON.stringify(r));

// 5. 할 일 하나 (기본 계정)
await ev(`const { store } = await import('/js/store.js'); store.put('tasks', { date: '2026-10-04', title: '기본 계정 할 일', done: false }); await new Promise(r => setTimeout(r, 2000)); return 1`);
r = await ev(`const d = __drive(); return Object.values(d.fakeMain?.data?.tasks || {}).map(t => t.title).join()`);
ok('기본 계정 드라이브에 할 일 저장', (r || '').includes('기본 계정 할 일'), r);

// 6. 할 일·가계부 담는 곳 → 추가 계정 (기록 없음 → 가져가기)
r = await ev(`${closeAll} ${openSet} const sel = document.querySelector('[data-data-place]'); const label = sel.closest('.set-select').innerText.replace(/\\s+/g, ' ').slice(0, 40); sel.value = 'work@company.com'; sel.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 1500)); const dlg = document.getElementById('dialogModal'); const msg = dlg.innerText; [...dlg.querySelectorAll('[data-answer]')].find(b => b.dataset.answer === 'copy').click(); return { label, msg: msg.slice(0, 80) }`);
ok('할 일·가계부 담는 곳: 설명 문구, 기록 없는 계정이면 가져갈지 물어봄', r.label.includes('담고, 불러와요') && r.msg.includes('가져갈까요'), JSON.stringify(r));
await sleep(3500);
r = await ev(`const { store, dataPlace } = await import('/js/store.js'); return { place: dataPlace(), tasks: store.list('tasks').map(t => t.title).join(), toast: document.getElementById('toast').innerText, extraDrive: Object.values(__drive().fakeExtra?.data?.tasks || {}).map(t => t.title).join() }`);
ok('바꾸면 그 계정 기록으로 열리고, 가져간 기록이 보임 + "○○의 할 일·가계부를 보고 있어요"', r.place === 'work@company.com' && r.tasks.includes('기본 계정 할 일') && r.extraDrive.includes('기본 계정 할 일') && r.toast.includes('보고 있어요'), JSON.stringify(r));

// 7. 추가 계정에서 쓴 할 일은 그 계정 드라이브에만
await ev(`const { store } = await import('/js/store.js'); store.put('tasks', { date: '2026-10-04', title: '회사 할 일', done: false }); await new Promise(r => setTimeout(r, 2500)); return 1`);
r = await ev(`const d = __drive(); return { extra: Object.values(d.fakeExtra.data.tasks).some(t => t.title === '회사 할 일'), main: Object.values(d.fakeMain.data.tasks).some(t => t.title === '회사 할 일') }`);
ok('추가 계정에서 쓴 할 일은 그 계정 드라이브에만 (기본 계정에는 안 들어감)', r.extra && !r.main, JSON.stringify(r));

// 8. 기본 계정으로 돌아가기 → 기본 계정 기록만
await ev(`${openSet} const sel = document.querySelector('[data-data-place]'); sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); return 1`);
await sleep(3500);
r = await ev(`const { store, dataPlace } = await import('/js/store.js'); return { place: dataPlace(), tasks: store.list('tasks').map(t => t.title).join() }`);
ok('기본 계정으로 돌아가면 기본 계정 기록만 (회사 할 일 없음)', r.place === '' && r.tasks.includes('기본 계정 할 일') && !r.tasks.includes('회사 할 일'), JSON.stringify(r));

// 9. 다시 추가 계정으로 (기록 있음 → 묻지 않음)
await ev(`${openSet} const sel = document.querySelector('[data-data-place]'); sel.value = 'work@company.com'; sel.dispatchEvent(new Event('change', { bubbles: true })); return 1`);
await sleep(4000);
r = await ev(`const { store, dataPlace } = await import('/js/store.js'); return { place: dataPlace(), tasks: store.list('tasks').map(t => t.title).join() }`);
ok('기록이 있는 계정으로 바꾸면 묻지 않고 그 기록이 보임', r.place === 'work@company.com' && r.tasks.includes('회사 할 일'), JSON.stringify(r));

// 10. 담는 곳으로 쓰던 계정을 빼면 기본 계정으로 돌아감
await ev(`${openMenu} document.querySelector('[data-act="toggle-accounts"]').click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('[data-act="gcal-remove"]').click(); await new Promise(r => setTimeout(r, 500)); document.querySelector('#dialogModal [data-answer="yes"]').click(); return 1`);
await sleep(3500);
r = await ev(`const { store, dataPlace } = await import('/js/store.js'); const g = await import('/js/sync/gcal.js'); return { place: dataPlace(), accts: g.accounts().length, tasks: store.list('tasks').map(t => t.title).join() }`);
ok('담는 곳 계정을 빼면 기본 계정 기록으로 돌아감', r.place === '' && r.accts === 1 && !r.tasks.includes('회사 할 일'), JSON.stringify(r));

// 11. 비우고 시작
await ev(`__driveSet(d => { delete d.fakeExtra; }); for (const n of ['damda:work@company.com']) await new Promise(r => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = r; }); localStorage.removeItem('ple-v1:work@company.com'); return 1`);
await ev(`${openMenu} document.querySelector('[data-act="gcal-add-account"]').click(); await new Promise(r => setTimeout(r, 2000)); ${closeAll} return 1`);
await ev(`${openSet} const sel = document.querySelector('[data-data-place]'); sel.value = 'work@company.com'; sel.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 1500)); document.querySelector('#dialogModal [data-answer="empty"]').click(); return 1`);
await sleep(3500);
r = await ev(`const { store, dataPlace } = await import('/js/store.js'); return { place: dataPlace(), tasks: store.list('tasks').length }`);
ok('"비우고 시작"을 고르면 빈 기록으로 시작', r.place === 'work@company.com' && r.tasks === 0, JSON.stringify(r));

// 12. 구글 연결 끊기 (설정 맨 아래) → 기본으로
r = await ev(`${openSet} const btn = document.querySelector('#settingsModal [data-act="google-disconnect"]'); const last = btn === [...document.querySelectorAll('#settingsModal .set-slot button')].pop(); btn.click(); await new Promise(r => setTimeout(r, 500)); document.querySelector('#dialogModal [data-answer="yes"]').click(); return { last }`);
await sleep(3000);
const r2 = await ev(`const { dataPlace } = await import('/js/store.js'); const s = await import('/js/sync/engine.js'); return { place: dataPlace(), connected: s.isConnected(), pill: document.getElementById('syncPill').innerText }`);
ok('[구글 연결 끊기]는 설정 맨 아래, 끊으면 기본 기록·이 기기에 저장으로', r.last && r2.place === '' && !r2.connected && r2.pill.includes('저장'), JSON.stringify({ ...r, ...r2 }));

ok('페이지 오류 없음', errors.length === 0, errors.join(' | '));
console.log(out.join('\n')); ws.close(); process.exit(0);
