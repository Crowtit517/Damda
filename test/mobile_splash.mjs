// 폰 시작 화면 점검: headless 크롬(9333)에서 폰 크기 + '홈 화면에 설치한 앱'(display-mode: standalone)을 흉내 낸다
import { spawn } from 'child_process';
import fs from 'fs';
const OUT = new URL('./pc_qa/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const p = spawn(chrome, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${process.env.TEMP}/damda-msplash-${Date.now()}`, 'about:blank']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
const t = (await (await fetch('http://127.0.0.1:9333/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(); const errors = [];
ws.onmessage = m => { const d = JSON.parse(m.data); wait.get(d.id)?.(d); if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(new URL(n + '.png', OUT), Buffer.from(r.result.data, 'base64')); };
const ok = (n, c, note = '') => console.log(c ? '✅' : '❌', n, note);
await send('Runtime.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
const splashState = () => ev(`(() => { const e = document.getElementById('bootSplash'); if (!e) return '없음(걷힘)'; const s = getComputedStyle(e); return s.display === 'none' ? '숨김' : '보임 opacity=' + s.opacity; })()`);

// 1) 홈 화면 앱(standalone) + 폰 크기
// headless 크롬은 display-mode 흉내를 못 해서, 시험할 때만 style.css의 '(display-mode: standalone)' 조건을 '항상'으로 바꿔 받는다
let standalone = true;
ws.addEventListener('message', async m => {
  const d = JSON.parse(m.data);
  if (d.method !== 'Fetch.requestPaused') return;
  const { requestId } = d.params;
  if (!standalone) return send('Fetch.continueRequest', { requestId });
  const body = await send('Fetch.getResponseBody', { requestId });
  let css = body.result.base64Encoded ? Buffer.from(body.result.body, 'base64').toString('utf8') : body.result.body;
  css = css.replace('@media (display-mode: standalone)', '@media all');
  send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/css; charset=utf-8' }], body: Buffer.from(css).toString('base64') });
});
await send('Fetch.enable', { patterns: [{ urlPattern: '*css/style.css*', requestStage: 'Response' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://localhost:5500/' });
await sleep(600); const s1 = await splashState(); await shot('m-splash-0600');
await sleep(800); await shot('m-splash-1400');
ok('홈 화면 앱: 켜자마자 시작 화면 보임', s1.startsWith('보임'), s1);
await sleep(1600);
const s2 = await splashState();
ok('홈 화면 앱: 약 2초 뒤 시작 화면 걷힘', s2 === '없음(걷힘)', s2);
await shot('m-after');
ok('홈 화면 앱: 걷힌 뒤 캘린더 누를 수 있음', await ev(`(() => { const c = document.querySelector('#view-calendar .cell.today'); const r = c.getBoundingClientRect(); return document.elementFromPoint(r.left + 5, r.top + 5)?.closest('.cell') === c; })()`));
// 같은 실행 안에서 새로고침 → 바로 걷힘
await send('Page.reload', {}); await sleep(900);
ok('새로고침하면 시작 화면을 오래 붙잡지 않음', (await splashState()) === '없음(걷힘)', await splashState());

// 2) 브라우저에서 사이트로 열기 → 시작 화면 없음
standalone = false;
await send('Page.navigate', { url: 'http://localhost:5500/?b=1' }); await sleep(400);
ok('브라우저로 열면 시작 화면 안 나옴', ['숨김', '없음(걷힘)'].includes(await splashState()), await splashState());
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://localhost:5500/?b=2' }); await sleep(1500);
ok('PC 크롬(웹)도 안 나옴', ['숨김', '없음(걷힘)'].includes(await splashState()), await splashState());
ok('페이지 오류 없음', errors.length === 0, errors.join(' | '));
ws.close(); p.kill();
