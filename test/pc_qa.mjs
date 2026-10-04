// PC 앱 전체 점검 (개발 모드: desktop/ 에서 electron . --dev --remote-debugging-port=9334)
// 화면을 하나씩 눌러 보며 결과·사진·오류를 모은다. 실제 기록이 아닌 localhost 저장소만 쓴다.
import fs from 'fs';
const OUT = new URL('./pc_qa/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const pages = async () => (await (await fetch('http://127.0.0.1:9334/json')).json()).filter(t => t.type === 'page');

async function connect(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = new Map(); const errors = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error: ' + d.params.args.map(a => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => {
    const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result;
    if (r?.exceptionDetails) errors.push('점검 중 오류: ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] + ' ← ' + expr.slice(0, 80));
    return r?.result?.value;
  };
  await send('Runtime.enable');
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(new URL(name + '.png', OUT), Buffer.from(r.result.data, 'base64')); };
  return { ev, send, shot, errors, close: () => ws.close() };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (area, name, cond, note = '') => { results.push({ area, name, ok: !!cond, note }); console.log(cond ? '✅' : '❌', `[${area}]`, name, note ? `— ${note}` : ''); };

// 시험용(localhost) 저장소를 비우고 담다·위젯을 다시 연다 (지난 점검에서 넣은 할 일이 남지 않게)
{
  const first = await connect((await pages()).find(t => !t.url.includes('__damda')));
  await first.send('Storage.clearDataForOrigin', { origin: 'http://localhost:5500', storageTypes: 'indexeddb,local_storage' });
  for (const t of await pages()) { const c = await connect(t); await c.send('Page.reload', {}); c.close(); }
  first.close();
  await sleep(3500);
}
const M = await connect((await pages()).find(t => !t.url.includes('__damda')));
const today = await M.ev(`new Date().toLocaleDateString('sv-SE')`);
const esc = () => M.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
const isOpen = sel => M.ev(`document.querySelector('${sel}')?.classList.contains('open') ?? false`);
const visible = sel => M.ev(`(() => { const e = document.querySelector('${sel}'); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
// 오른쪽 구역과 캘린더가 겹치는지 / 캘린더가 창 밖으로 나가는지
const layout = () => M.ev(`(() => {
  const g = document.querySelector('#view-calendar .grid').getBoundingClientRect(), side = document.querySelector('.desk-tabs').getBoundingClientRect();
  return { w: innerWidth, h: innerHeight, gridRight: Math.round(g.right), gridBottom: Math.round(g.bottom), sideLeft: Math.round(side.left), sideW: Math.round(side.width) };
})()`);

// ---- 1. 시작 ----
ok('시작', 'PC 화면 켜짐', await M.ev(`document.documentElement.classList.contains('desk-app')`));
ok('시작', '[이 날] 탭 + 오늘 패널', await M.ev(`document.querySelector('.desk-tabs .on')?.dataset.screen === 'calendar'`) && await visible('#dayPanel'));
let L = await layout();
ok('시작', '캘린더와 오른쪽 구역이 안 겹침', L.gridRight <= L.sideLeft, JSON.stringify(L));
ok('시작', '캘린더가 창 안에 다 들어옴(세로)', L.gridBottom <= L.h, `grid 아래 ${L.gridBottom} / 창 ${L.h}`);
await M.shot('01-start');

// ---- 2. 캘린더 ----
const monthTitle = () => M.ev(`document.querySelector('.month-btn')?.textContent.trim()`);
const m0 = await monthTitle();
await M.ev(`document.querySelector('[data-act="next"]').click()`); await sleep(200);
const m1 = await monthTitle();
ok('캘린더', '다음 달 ›', m0 !== m1, `${m0} → ${m1}`);
ok('캘린더', '다른 달이면 [오늘] 버튼 보임', await M.ev(`!!document.querySelector('.cal-tools [data-act="today"]')`));
await M.ev(`document.querySelector('.cal-tools [data-act="today"]').click()`); await sleep(200);
ok('캘린더', '[오늘]로 이번 달 돌아옴', (await monthTitle()) === m0);
await M.ev(`document.querySelector('[data-act="pick"]').click()`); await sleep(400);
ok('캘린더', '월 선택 창 열림', await isOpen('#monthPicker'));
await M.shot('02-month-picker');
await M.ev(`document.querySelector('#monthPicker [data-month="0"]').click()`); await sleep(400);
ok('캘린더', '월 선택 → 1월로 이동 + 창 닫힘', (await monthTitle()).startsWith('1월') && !(await isOpen('#monthPicker')), await monthTitle());
await M.ev(`document.querySelector('[data-act="pick"]').click()`); await sleep(300);
await esc(); await sleep(400);
ok('캘린더', '월 선택 창 Esc로 닫힘', !(await isOpen('#monthPicker')));
await M.ev(`document.querySelector('.cal-tools [data-act="today"]')?.click()`); await sleep(200);
// 6주짜리 달에서도 칸이 창 안에 들어오는지 (2026년 8월은 6줄)
await M.ev(`document.querySelector('[data-act="pick"]').click()`); await sleep(300);
await M.ev(`document.querySelector('#monthPicker [data-month="7"]').click()`); await sleep(400);
L = await layout();
ok('캘린더', '6주짜리 달(8월)도 창 안에 들어옴', L.gridBottom <= L.h, `rows=${await M.ev(`document.querySelectorAll('#view-calendar .cell').length / 7`)}, grid 아래 ${L.gridBottom} / 창 ${L.h}`);
await M.shot('03-six-weeks');
await M.ev(`document.querySelector('.cal-tools [data-act="today"]')?.click()`); await sleep(200);

// 💰
const moneyOn = () => M.ev(`document.querySelector('[data-act="money"]').getAttribute('aria-checked') === 'true'`);
const wasMoney = await moneyOn();
await M.ev(`document.querySelector('[data-act="money"]').click()`); await sleep(300);
ok('캘린더', '💰 스위치 켜고 끄기', (await moneyOn()) !== wasMoney);
await M.ev(`document.querySelector('[data-act="money"]').click()`); await sleep(300);

// ---- 3. 이 날: 일정 ----
await M.ev(`document.querySelector('#view-calendar .cell.today').click()`); await sleep(300);
await M.ev(`document.querySelector('#dayPanel .event-add').open = true`); await sleep(200);
await M.ev(`(() => { const f = document.querySelector('#dayPanel .events-add .event-form'); f.title.value = '점검 일정'; f.time.value = '14:30'; f.time.dispatchEvent(new Event('input', { bubbles: true })); f.requestSubmit(); })()`); await sleep(600);
ok('이 날', '일정 추가', await M.ev(`document.querySelector('#dayPanel .events-list').innerText.includes('점검 일정')`));
ok('이 날', '캘린더 칸에 일정 점 표시', await M.ev(`!!document.querySelector('#view-calendar .cell.today .cell-dots i')`));
await M.ev(`[...document.querySelectorAll('#dayPanel .event[data-ev]')].find(r => r.innerText.includes('점검 일정')).click()`); await sleep(500);
ok('이 날', '일정 누르면 고치기 창', await isOpen('#eventModal'));
await M.shot('04-event-editor');
await M.ev(`(() => { const f = document.querySelector('#eventModal form'); f.title.value = '점검 일정(고침)'; f.requestSubmit(); })()`); await sleep(600);
ok('이 날', '일정 고치기 저장', !(await isOpen('#eventModal')) && await M.ev(`document.querySelector('#dayPanel .events-list').innerText.includes('점검 일정(고침)')`));
await M.ev(`[...document.querySelectorAll('#dayPanel .event[data-ev]')].find(r => r.innerText.includes('점검 일정(고침)')).querySelector('[data-act="delete-event"]').click()`); await sleep(500);
ok('이 날', '일정 지우기', !(await M.ev(`document.querySelector('#dayPanel .events-list').innerText.includes('점검 일정(고침)')`)));
const toast = await M.ev(`(() => { const t = document.getElementById('toast'); if (t.hidden) return null; const r = t.getBoundingClientRect(); return { text: t.innerText.replace(/\\s+/g, ' '), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) }; })()`);
ok('이 날', '지우기 알림(되돌리기) 보임', !!toast, JSON.stringify(toast));
if (toast) ok('이 날', '알림이 오른쪽 구역에 가려지지 않음', toast.right <= L.sideLeft || await M.ev(`+getComputedStyle(document.getElementById('toast')).zIndex > 55`), `toast ${toast.left}~${toast.right}, 오른쪽 구역 ${L.sideLeft}~`);
await M.shot('05-toast');
await M.ev(`document.querySelector('#toast .toast-action')?.click()`); await sleep(500);
ok('이 날', '되돌리기로 일정 돌아옴', await M.ev(`document.querySelector('#dayPanel .events-list').innerText.includes('점검 일정(고침)')`));
// 이 날 ‹ ›
const dTitle = () => M.ev(`document.querySelector('#dayPanel .nav-slot')?.innerText.replace(/\\s+/g, ' ')`);
const d0 = await dTitle();
await M.ev(`document.querySelector('#dayPanel .nav-slot button:last-of-type')?.click()`); await sleep(300);
ok('이 날', '다음 날 ›', d0 !== await dTitle(), `${d0} → ${await dTitle()}`);
ok('이 날', '날짜를 옮기면 캘린더 선택도 따라감', await M.ev(`document.querySelector('#view-calendar .cell.selected')?.dataset.key !== '${today}'`));
await M.ev(`document.querySelector('#view-calendar .cell.today').click()`); await sleep(300);

// ---- 4. 할 일 ----
await M.ev(`document.querySelector('#dayPanel [data-goto="tasks"]').click()`); await sleep(500);
ok('할 일', '[할 일에서 추가·편집 ›] → 할 일 탭', await M.ev(`document.querySelector('.desk-tabs .on')?.dataset.screen === 'tasks' && !document.getElementById('view-tasks').hidden`));
for (const t of ['점검 할 일 1', '점검 할 일 2']) {
  await M.ev(`(() => { const i = document.querySelector('#view-tasks .task-input'); i.value = '${t}'; i.closest('form').requestSubmit(); })()`); await sleep(300);
}
ok('할 일', '할 일 추가 2개', await M.ev(`document.getElementById('view-tasks').innerText.includes('점검 할 일 2')`));
ok('할 일', '추가한 뒤 입력칸에 커서 유지', await M.ev(`document.activeElement?.classList.contains('task-input')`));
await M.ev(`[...document.querySelectorAll('#view-tasks .task')].find(r => r.innerText.includes('점검 할 일 1'))?.querySelector('input[type=checkbox]')?.click()`); await sleep(400);
ok('할 일', '체크', await M.ev(`import('./js/store.js').then(({ store }) => store.byDate('tasks', '${today}').some(t => t.title === '점검 할 일 1' && t.done))`));
ok('할 일', '체크가 캘린더 칸 ✓ 숫자에 반영', await M.ev(`document.querySelector('#view-calendar .cell.today').innerText.includes('✓')`));
await M.shot('06-tasks');
await M.ev(`document.querySelector('#view-tasks [data-act="repeat-toggle"]')?.click()`); await sleep(400);
ok('할 일', '[반복] 누르면 반복 입력으로', await M.ev(`(document.querySelector('#view-tasks .task-input')?.placeholder || '').includes('반복')`));
await M.shot('07-repeat');
await M.ev(`document.querySelector('#view-tasks [data-act="repeat-toggle"]')?.click()`); await sleep(300);
// 카테고리
await M.ev(`[...document.querySelectorAll('#view-tasks button')].find(b => b.textContent.includes('카테고리 추가'))?.click()`); await sleep(500);
const catOpen = await M.ev(`[...document.querySelectorAll('.modal.open, .drawer.open, [class*="cat"].open')].map(e => e.id || e.className).join(',')`);
ok('할 일', '카테고리 추가 창 열림', !!catOpen, catOpen);
await M.shot('08-category');
await esc(); await sleep(400); await esc(); await sleep(300);
ok('할 일', '카테고리 창 Esc로 닫힘', !(await M.ev(`!!document.querySelector('.modal.open')`)));
// 지우기
await M.ev(`[...document.querySelectorAll('#view-tasks .task')].find(r => r.innerText.includes('점검 할 일 2'))?.querySelector('[data-act="delete"]')?.click()`); await sleep(400);
ok('할 일', '할 일 지우기', !(await M.ev(`[...document.querySelectorAll('#view-tasks .task')].some(r => r.innerText.includes('점검 할 일 2'))`)));

// ---- 5. 가계부 ----
await M.ev(`document.querySelector('.desk-tabs [data-screen="ledger"]').click()`); await sleep(500);
ok('가계부', '[가계부] 탭', await visible('#view-ledger'));
await M.ev(`document.getElementById('view-ledger').scrollTop = 400`);
await M.ev(`document.querySelector('.desk-tabs [data-screen="tasks"]').click()`); await sleep(200);
await M.ev(`document.querySelector('.desk-tabs [data-screen="ledger"]').click()`); await sleep(300);
ok('가계부', '탭을 다시 열면 맨 위부터', (await M.ev(`document.getElementById('view-ledger').scrollTop`)) === 0);
await M.shot('09-ledger');
const ledgerHasForm = await M.ev(`!!document.querySelector('#view-ledger .entry-form')`);
if (ledgerHasForm) {
  await M.ev(`(() => { const f = document.querySelector('#view-ledger .entry-form'); f.querySelector('.amount-input').value = '12000'; f.querySelector('.memo-input').value = '점검 점심'; f.requestSubmit(); })()`); await sleep(500);
  ok('가계부', '지출 추가', await M.ev(`import('./js/store.js').then(({ store }) => store.list('expenses').some(x => x.memo === '점검 점심' && x.amount === 12000))`));
} else ok('가계부', '가계부 화면에 바로 입력칸이 있음', false, '가계부 탭에는 입력칸이 없음 (날짜를 골라야 하는지 확인 필요)');
await M.ev(`document.querySelector('#view-ledger [data-mode="year"]')?.click()`); await sleep(400);
ok('가계부', '[년] 보기', await M.ev(`document.getElementById('view-ledger').innerText.includes('년 카테고리별')`));
await M.shot('10-ledger-year');
await M.ev(`document.querySelector('#view-ledger [data-mode="month"]')?.click()`); await sleep(300);
await M.ev(`document.querySelector('#view-ledger [data-act="add-rule"]')?.click()`); await sleep(500);
ok('가계부', '고정 수입·지출 [+ 추가] 창', await isOpen('#recurringModal'));
await M.shot('11-recurring');
await esc(); await sleep(400);
const ledgerScroll = await M.ev(`(() => { const v = document.getElementById('view-ledger'); return { scroll: v.scrollHeight > v.clientHeight, overflowX: v.scrollWidth > v.clientWidth + 1 }; })()`);
ok('가계부', '오른쪽 구역에서 가로로 넘치지 않음', !ledgerScroll.overflowX, JSON.stringify(ledgerScroll));

// ---- 6. 이 날 패널의 가계부 칸 ----
await M.ev(`document.querySelector('#view-calendar .cell.today').click()`); await sleep(400);
ok('이 날', '할 일·가계부 탭에서 날짜 누르면 [이 날]로', await M.ev(`document.querySelector('.desk-tabs .on')?.dataset.screen === 'calendar'`));
ok('이 날', '가계부 칸에 방금 지출 보임', !ledgerHasForm || await M.ev(`document.getElementById('dayPanel').innerText.includes('12,000')`));

// ---- 7. 메뉴 · 설정 · 가이드 · 테마 ----
await M.ev(`document.getElementById('menuBtn').click()`); await sleep(500);
ok('메뉴', '☰ 메뉴 열림', await isOpen('#menuModal'));
ok('메뉴', '메뉴에 PC 칸 없음', !(await M.ev(`!!document.querySelector('#menuModal .desk-widgets')`)));
await M.shot('12-menu');
await M.ev(`document.querySelector('#menuModal [data-screen="tasks"]').click()`); await sleep(500);
ok('메뉴', '메뉴에서 [할 일] → 오른쪽 할 일 탭', await M.ev(`document.querySelector('.desk-tabs .on')?.dataset.screen === 'tasks'`) && !(await isOpen('#menuModal')));
await M.ev(`document.getElementById('menuBtn').click()`); await sleep(400);
await M.ev(`document.querySelector('#menuModal [data-act="open-settings"]').click()`); await sleep(500);
ok('메뉴', '⚙️ 설정 창 열림', await isOpen('#settingsModal'));
await M.shot('13-settings');
const setBox = await M.ev(`(() => { const r = document.querySelector('#settingsModal .modal-box').getBoundingClientRect(); return { top: Math.round(r.top), right: Math.round(r.right) }; })()`);
ok('메뉴', '설정 창이 위쪽 줄(끌어서 옮기기)과 안 겹침', setBox.top >= 57, JSON.stringify(setBox));
await M.ev(`document.querySelector('#settingsModal [data-close]').click()`); await sleep(400);
ok('메뉴', '설정 창 ✕', !(await isOpen('#settingsModal')));
await esc(); await sleep(400);
ok('메뉴', '메뉴 Esc로 닫힘', !(await isOpen('#menuModal')));
await M.ev(`document.querySelector('.desk-tabs [data-screen="calendar"]').click()`); await sleep(300);
await M.ev(`document.getElementById('helpBtn').click()`); await sleep(500);
ok('메뉴', '? 가이드 열림', await isOpen('#guideModal'));
await M.shot('14-guide');
await esc(); await sleep(400);
ok('메뉴', '가이드 Esc로 닫힘', !(await isOpen('#guideModal')));
const theme0 = await M.ev(`document.documentElement.dataset.theme || 'auto'`);
await M.ev(`document.getElementById('themeToggle').click()`); await sleep(400);
await M.shot('15-theme');
ok('메뉴', '테마 바꾸기', theme0 !== await M.ev(`document.documentElement.dataset.theme || 'auto'`));
// 어두운 테마에서 오른쪽 구역·칸 선 보이는지 사진으로 확인 후 되돌림
await M.ev(`document.querySelector('.desk-tabs [data-screen="ledger"]').click()`); await sleep(400);
await M.shot('16-dark-ledger');
await M.ev(`document.querySelector('.desk-tabs [data-screen="calendar"]').click()`); await sleep(200);
await M.ev(`document.getElementById('themeToggle').click()`); await sleep(300);
if (theme0 !== await M.ev(`document.documentElement.dataset.theme || 'auto'`)) { await M.ev(`document.getElementById('themeToggle').click()`); await sleep(300); }

// ---- 8. 단축키 ----
await M.ev(`document.querySelector('.desk-tabs [data-screen="ledger"]').click()`); await sleep(300);
await M.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', altKey: true, bubbles: true }))`); await sleep(400);
ok('단축키', 'Alt+N → 할 일 입력칸', await M.ev(`document.activeElement?.classList.contains('task-input')`), await M.ev(`document.querySelector('.desk-tabs .on')?.dataset.screen`));
await M.ev(`document.activeElement?.blur()`);

// ---- 9. 창 크기 ----
for (const [w, h] of [[960, 600], [1920, 1040]]) {
  await M.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(500);
  await M.ev(`document.querySelector('.desk-tabs [data-screen="calendar"]').click()`); await sleep(300);
  L = await layout();
  ok('창 크기', `${w}×${h}: 겹침 없음·오른쪽 1/3 이하`, L.gridRight <= L.sideLeft && L.sideW <= Math.ceil(w / 3) + 1, JSON.stringify(L));
  const tabsFit = await M.ev(`(() => { const n = document.querySelector('.desk-tabs'); return [...n.querySelectorAll('button')].every(b => b.scrollWidth <= b.clientWidth + 1); })()`);
  ok('창 크기', `${w}×${h}: 탭 글자가 안 잘림`, tabsFit);
  const clipped = await M.ev(`[...document.querySelectorAll('#view-calendar .cell')].filter(c => c.scrollHeight > c.clientHeight + 1).map(c => c.dataset.key)`);
  ok('창 크기', `${w}×${h}: 날짜 칸 글자가 안 잘림`, clipped.length === 0, clipped.join(','));
  await M.shot(`17-size-${w}`);
}
await M.send('Emulation.clearDeviceMetricsOverride'); await sleep(400);

// ---- 10. 위젯 ----
await M.ev(`document.querySelector('.cal-tools [data-act="widget"]').click()`); await sleep(2500);
const wt = (await pages()).find(t => t.url.includes('__damda_widget'));
ok('위젯', '[위젯으로 보기]로 열림', !!wt);
if (wt) {
  const W = await connect(wt);
  await W.ev(`document.querySelector('.seg [data-view="month"]').click()`); await sleep(600);
  ok('위젯', '달력 보기에 오늘 할 일·쓴 돈', await W.ev(`(() => { const t = document.querySelector('.day.today')?.innerText || ''; return t.includes('✓') && t.includes('12,000'); })()`) || !ledgerHasForm);
  await W.ev(`document.querySelector('.day.today').click()`); await sleep(300);
  await W.ev(`(() => { const f = document.querySelector('#sheet form[data-form="task"]'); f.title.value = '위젯 점검'; f.requestSubmit(); })()`); await sleep(700);
  ok('위젯', '위젯에서 넣은 할 일이 담다에 바로', await M.ev(`import('./js/store.js').then(({ store }) => store.byDate('tasks', '${today}').some(t => t.title === '위젯 점검'))`));
  ok('위젯', '담다 캘린더 칸도 바로 바뀜', await M.ev(`document.querySelector('#view-calendar .cell.today').innerText.includes('/')`));
  await W.ev(`[...document.querySelectorAll('#sheet .task')].find(r => r.innerText.includes('위젯 점검'))?.querySelector('input').click()`); await sleep(600);
  ok('위젯', '위젯에서 체크 → 담다에 완료', await M.ev(`import('./js/store.js').then(({ store }) => store.byDate('tasks', '${today}').some(t => t.title === '위젯 점검' && t.done))`));
  await W.ev(`document.querySelector('.seg [data-view="day"]').click()`); await sleep(900);
  ok('위젯', '[오늘 요약]', await W.ev(`document.body.className === 'view-day'`));
  await W.shot('18-widget-day');
  await W.ev(`document.querySelector('.seg [data-view="month"]').click()`); await sleep(900);
  await W.shot('19-widget-month');
  // 담다에서 💰 끄기 → 위젯
  await M.ev(`document.querySelector('[data-act="money"]').click()`); await sleep(600);
  ok('위젯', '💰 끄면 위젯 금액도 사라짐', !(await W.ev(`document.querySelector('.day.today')?.innerText.includes('12,000')`)));
  await M.ev(`document.querySelector('[data-act="money"]').click()`); await sleep(400);
  // 날짜가 넘어가면? (자정) — 시계를 바꿀 수 없어 생략
  ok('위젯', '위젯 오류 없음', W.errors.length === 0, W.errors.join(' | '));
  W.close();
}

// ---- 11. 정리 ----
ok('전체', '담다 화면 오류 없음', M.errors.length === 0, M.errors.join(' | '));
fs.writeFileSync(new URL('results.json', OUT), JSON.stringify({ results, errors: M.errors }, null, 2));
console.log(`\n통과 ${results.filter(r => r.ok).length} / ${results.length}`);
M.close();
