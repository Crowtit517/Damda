// 헤드리스 Chrome(CDP)으로 PWA 설치 가능 여부 점검 + 화면 캡처
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const chrome = process.env.SKIP_SPAWN ? { kill() {} } : spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json()); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://localhost:5500/' });
await sleep(2500);
await send('Page.reload'); // 두 번째 로드부터 서비스 워커가 페이지를 제어
await sleep(2500);

const report = {};
report.installabilityErrors = (await send('Page.getInstallabilityErrors')).result?.installabilityErrors;
const man = (await send('Page.getAppManifest')).result;
report.manifestUrl = man?.url;
report.manifestErrors = man?.errors;
report.sw = await evalJs(`navigator.serviceWorker.getRegistration().then(r => ({ state: r?.active?.state, controlled: !!navigator.serviceWorker.controller }))`);
report.cached = await evalJs(`caches.keys().then(async k => k.length ? (await (await caches.open(k[0])).keys()).length : 0)`);

// 오프라인에서도 열리는지
await send('Network.enable');
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await send('Page.reload');
await sleep(2000);
report.offlineTitle = await evalJs(`document.querySelector('.brand')?.textContent + ' / ' + (document.querySelector('.month-btn')?.textContent || '').trim()`);
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

// 샘플 데이터 + 화면 캡처
const shot = async name => {
  await sleep(500);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
};
await evalJs(`(() => {
  localStorage.clear();
  const now = Date.now(), t = new Date(), k = d => { const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + d); return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0'); };
  const T = (id, d, title, category, done) => ({ id, date: k(d), title, category, done, createdAt: now + id.length, updatedAt: now, deleted: false });
  const data = { version: 1, expenses: {}, categories: {},
    tasks: { a: T('a', 0, '프로젝트 기획서 검토', 'work', true), b: T('b', 0, '주말 가족 모임 장소 예약', 'personal', false), c: T('c', 0, '영어 단어 30개', 'study', false) },
    events: { v2: { id: 'v2', title: '팀 회의', start: k(0), end: k(0), time: '14:00', color: '#7fa8ff', createdAt: now, updatedAt: now, deleted: false } } };
  localStorage.setItem('ple-v1', JSON.stringify(data));
})()`);

const go = async (theme, tab, extra = '') => {
  await evalJs(`localStorage.setItem('ple-theme', '"${theme}"'); localStorage.setItem('ple-tab', '"${tab}"'); ${extra}`);
  await send('Page.reload'); await sleep(1500);
};
for (const [mode, w, h, mobile] of [['desktop', 1280, 1100, false], ['mobile', 390, 1400, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  for (const theme of ['light', 'dark']) {
    await go(theme, 'ledger', `localStorage.setItem('ple-ledger-mode', '"month"')`);
    await shot(`${mode}-${theme}-ledger-month.png`);
    await go(theme, 'ledger', `localStorage.setItem('ple-ledger-mode', '"year"')`);
    await shot(`${mode}-${theme}-ledger-year.png`);
    await go(theme, 'tasks');
    await shot(`${mode}-${theme}-tasks.png`);
  }
}
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await go('light', 'ledger', `localStorage.setItem('ple-ledger-mode', '"month"')`);
// 그래프 툴팁
await evalJs(`(() => { const r = document.querySelector('.hit').getBoundingClientRect(); document.querySelector('.hit').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * 0.06, clientY: r.top + 40 })); })()`);
await shot('mobile-light-ledger-tooltip.png');
await go('light', 'tasks');
await evalJs(`(() => { const s = document.querySelector('#tabTasks .task-cat'); s.value = '__manage'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await shot('mobile-light-category-manage.png');
await go('dark', 'calendar');
await evalJs(`document.querySelector('.cell.today').click()`);
await shot('mobile-dark-panel.png');
report.overflow = await evalJs(`document.documentElement.scrollWidth + 'x' + document.documentElement.clientWidth`);

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
ws.close();
chrome.kill();
process.exit(0);
