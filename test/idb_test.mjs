// IndexedDB 전환 검증 (별도 헤드리스 크롬, 임시 프로필)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };

async function openTab() {
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
    if (r.result?.exceptionDetails) return 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300);
    return r.result?.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  return { ws, send, ev, errors, targetId: t.id };
}
const go = async (tab, url = 'http://localhost:5500/') => { await tab.send('Page.navigate', { url }); await sleep(1500); };
const count = `const d = JSON.parse(localStorage.getItem('ple-v1') || '{}');`;
const idbCount = `
  const db = await new Promise((res, rej) => { const r = indexedDB.open('damda'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const rows = await new Promise(res => { const q = db.transaction('items').objectStore('items').getAll(); q.onsuccess = () => res(q.result); });
  const meta = await new Promise(res => { const q = db.transaction('meta').objectStore('meta').get('migrated'); q.onsuccess = () => res(q.result); });
  db.close();`;

const A = await openTab();
await go(A);
// 0. 깨끗하게 + 예전 사용자 데이터(ple-v1) 만들기
await A.ev(`localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('damda'); q.onsuccess = q.onerror = q.onblocked = r; });
  const now = Date.now();
  const d = { version: 1, tasks: {}, expenses: {}, events: {}, categories: {}, recurring: {}, taskRules: {}, catFolders: {} };
  for (let i = 0; i < 40; i++) d.tasks['t' + i] = { id: 't' + i, date: '2026-10-0' + (1 + (i % 4)), title: '할 일 ' + i, done: i % 2 === 0, createdAt: now - 1e6, updatedAt: now - 1e6, deleted: false };
  for (let i = 0; i < 30; i++) d.expenses['e' + i] = { id: 'e' + i, date: '2026-10-0' + (1 + (i % 4)), type: 'expense', amount: 1000 * (i + 1), memo: '지출 ' + i, createdAt: now - 1e6, updatedAt: now - 1e6, deleted: false };
  d.categories.c1 = { id: 'c1', kind: 'task', name: '건강', slot: 2, createdAt: now - 1e6, updatedAt: now - 1e6, deleted: false };
  localStorage.setItem('ple-v1', JSON.stringify(d)); return 'seeded'`);
await A.send('Page.reload'); await sleep(1800);

// 1. 옮겨 담기
let r = await A.ev(`${idbCount} const m = await import('/js/store.js'); ${count}
  return { backend: m.storageBackend(), idb: rows.length, meta: !!meta, tasks: m.store.list('tasks').length, exp: m.store.list('expenses').length, localLeft: Object.keys(d.tasks || {}).length }`);
ok('예전 데이터(ple-v1) → IndexedDB로 옮김', r.backend === 'idb' && r.idb === 71 && r.meta, JSON.stringify(r));
ok('화면이 읽는 데이터 수 그대로', r.tasks === 40 && r.exp === 30);
ok('예전 ple-v1은 백업으로 남아 있음', r.localLeft === 40);

// 2. 새로 적은 것 / 지운 것이 새로고침 뒤에도 유지
await A.ev(`const { store } = await import('/js/store.js'); store.put('tasks', { id: 'new1', date: '2026-10-04', title: '새 할 일', done: false }); store.remove('tasks', 't0'); await new Promise(r => setTimeout(r, 300)); return 1`);
await A.send('Page.reload'); await sleep(1800);
r = await A.ev(`const { store } = await import('/js/store.js'); return { added: !!store.get('tasks', 'new1'), deletedStays: store.get('tasks', 't0') === null, peekDeleted: store.peek('tasks', 't0')?.deleted }`);
ok('새로 적은 할 일이 새로고침 뒤에도 남음', r.added, JSON.stringify(r));
ok('지운 할 일이 예전 백업 때문에 되살아나지 않음', r.deletedStays && r.peekDeleted === true);

// 3. 예전 저장소에 더 새로운 기록이 있으면 합쳐짐 (IndexedDB를 못 쓴 날 시나리오)
await A.ev(`${count} d.tasks.fromLocal = { id: 'fromLocal', date: '2026-10-04', title: '메모지에만 적힌 할 일', done: false, createdAt: Date.now(), updatedAt: Date.now(), deleted: false }; localStorage.setItem('ple-v1', JSON.stringify(d)); return 1`);
await A.send('Page.reload'); await sleep(1800);
r = await A.ev(`${idbCount} const { store } = await import('/js/store.js'); return { inStore: !!store.get('tasks', 'fromLocal'), inIdb: rows.some(x => x.key === 'tasks/fromLocal') }`);
ok('메모지에만 있던 새 기록을 IndexedDB로 합침', r.inStore && r.inIdb, JSON.stringify(r));

// 4. 동기화(importData)로 들어온 항목도 저장됨
await A.ev(`const { store } = await import('/js/store.js'); store.importData({ version: 1, tasks: { remote1: { id: 'remote1', date: '2026-10-05', title: '다른 기기에서 온 할 일', done: false, createdAt: Date.now(), updatedAt: Date.now() + 5, deleted: false } } }); await new Promise(r => setTimeout(r, 300)); return 1`);
await A.send('Page.reload'); await sleep(1800);
r = await A.ev(`const { store } = await import('/js/store.js'); return !!store.get('tasks', 'remote1')`);
ok('동기화로 받은 항목도 IndexedDB에 저장', r === true);

// 5. 두 탭: 한쪽에서 적으면 다른 쪽 화면도 바뀜
const B = await openTab();
await go(B);
await A.ev(`const { store } = await import('/js/store.js'); store.put('tasks', { id: 'tabA', date: '2026-10-04', title: '탭 A에서 적음', done: false }); return 1`);
await sleep(800);
r = await B.ev(`const { store } = await import('/js/store.js'); return !!store.get('tasks', 'tabA')`);
ok('다른 탭에도 바로 반영 (BroadcastChannel)', r === true);
await B.ws.close();

// 6. 앱 화면이 오류 없이 그려짐 (세 화면)
r = await A.ev(`const out = []; for (const t of ['calendar', 'tasks', 'ledger']) { document.getElementById('menuBtn').click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('[data-screen=' + t + ']').click(); await new Promise(r => setTimeout(r, 300)); out.push(document.getElementById('view-' + t).innerText.length > 20); } return out`);
ok('캘린더·할 일·가계부 화면 정상', Array.isArray(r) && r.every(Boolean), JSON.stringify(r));
ok('페이지 오류 없음 (IndexedDB 모드)', A.errors.length === 0, A.errors.join(' | ').slice(0, 200));

// 7. IndexedDB를 못 쓰는 브라우저 → localStorage로 계속 동작
const C = await openTab();
await C.send('Page.addScriptToEvaluateOnNewDocument', { source: 'try { Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true }); } catch (e) {}' });
await go(C);
r = await C.ev(`const m = await import('/js/store.js'); m.store.put('tasks', { id: 'offline1', date: '2026-10-04', title: 'IndexedDB 없이 적음', done: false }); ${count} return { backend: m.storageBackend(), saved: !!d.tasks.offline1, tasks: m.store.list('tasks').length }`);
ok('IndexedDB 없으면 localStorage로 계속 저장', r.backend === 'local' && r.saved, JSON.stringify(r));
ok('페이지 오류 없음 (대체 모드)', C.errors.length === 0, C.errors.join(' | ').slice(0, 200));
await C.ws.close();

// 8. 다시 IndexedDB를 쓸 수 있게 되면 그날 적은 것도 합쳐짐
await A.send('Page.reload'); await sleep(1800);
r = await A.ev(`const m = await import('/js/store.js'); return { backend: m.storageBackend(), merged: !!m.store.get('tasks', 'offline1') }`);
ok('대체 모드에서 적은 기록도 IndexedDB로 합침', r.backend === 'idb' && r.merged, JSON.stringify(r));

// 9. 많이 쌓였을 때 속도 (할 일 5,000개)
r = await A.ev(`const { store } = await import('/js/store.js'); const t0 = performance.now(); store.batch(() => { for (let i = 0; i < 5000; i++) store.put('tasks', { id: 'bulk' + i, date: '2026-09-01', title: '대량 ' + i, done: false }); }); const t1 = performance.now(); await new Promise(r => setTimeout(r, 1500)); const t2 = performance.now(); store.put('tasks', { id: 'one', date: '2026-10-04', title: '하나 더', done: false }); const t3 = performance.now(); return { bulkMs: Math.round(t1 - t0), oneMs: +(t3 - t2).toFixed(2) }`);
await sleep(1000);
await A.send('Page.reload'); await sleep(2500);
const r2 = await A.ev(`const { store } = await import('/js/store.js'); return store.list('tasks').length`);
ok('5,000개 저장 후 새로고침해도 모두 남음', r2 >= 5000, `할 일 ${r2}개`);
ok('항목 하나 저장이 화면을 멈추지 않음 (5ms 미만)', r.oneMs < 5, JSON.stringify(r));

console.log(results.join('\n'));
await A.ws.close();
process.exit(0);
