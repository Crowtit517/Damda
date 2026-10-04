// 시험: 위젯 하나(달력 ↔ 오늘 요약), 담다 버튼, 💰 끄기 반영, 서로 반영
const list = async () => (await (await fetch('http://127.0.0.1:9334/json')).json()).filter(t => t.type === 'page');
async function connect(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result; if (r.exceptionDetails) console.log('  (오류)', r.exceptionDetails.exception?.description); return r.result?.value; };
  return { ev, close: () => ws.close() };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond) => console.log(cond ? '✅' : '❌', name);
const today = new Date().toLocaleDateString('sv-SE');

const M = await connect((await list()).find(t => t.url === 'http://localhost:5500/'));
ok('캘린더 위쪽에 [위젯으로 보기] 버튼', await M.ev(`!!document.querySelector('.cal-tools .desk-widget-btn')`));
await M.ev(`document.getElementById('menuBtn').click()`);
await sleep(400);
ok('☰ 메뉴에 [위젯 열기]·[담다 끝내기]', await M.ev(`!!document.querySelector('#menuModal [data-desk="widget"]') && !!document.querySelector('#menuModal [data-desk="quit"]')`));
await M.ev(`document.querySelector('#menuModal [data-desk="widget"]').click()`);
await sleep(2500);
const wt = (await list()).find(t => t.url.includes('__damda_widget'));
ok('[위젯 열기]로 위젯이 열림', !!wt);
await M.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
const W = await connect(wt);
ok('열면 달력이 먼저 나옴', await W.ev(`document.body.className === 'view-month' && document.querySelectorAll('.month').length === 15`));
ok('위쪽에 [달력 | 오늘 요약] 버튼', await W.ev(`[...document.querySelectorAll('.seg button')].map(b => b.textContent).join('|') === '달력|오늘 요약'`));

// 💰 켜진 상태 → 금액 보임
await M.ev(`(() => { const b = document.querySelector('[data-act="money"]'); if (b.getAttribute('aria-checked') !== 'true') b.click(); })()`);
await sleep(500);
ok('💰 켜짐: 달력 칸에 쓴 돈 보임', await W.ev(`/-4,500/.test(document.querySelector('.day.today').innerText)`));
// 💰 끄기 → 위젯에서도 사라짐
await M.ev(`document.querySelector('[data-act="money"]').click()`);
await sleep(600);
ok('💰 끔: 달력 칸에서 쓴 돈 사라짐', await W.ev(`!/4,500/.test(document.querySelector('.day.today').innerText)`));
await W.ev(`document.querySelector('.seg [data-view="day"]').click()`);
await sleep(800);
const dayText = await W.ev(`document.getElementById('card').innerText`);
ok('[오늘 요약]을 누르면 하루 보기로 바뀜', await W.ev(`document.body.className === 'view-day'`) && dayText.includes('오늘 일정'));
ok('💰 끔: 오늘 요약에도 쓴 돈 칸 없음', !dayText.includes('오늘 쓴 돈'));
await M.ev(`document.querySelector('[data-act="money"]').click()`);
await sleep(600);
ok('💰 다시 켬: 오늘 요약에 쓴 돈 칸 돌아옴', (await W.ev(`document.getElementById('card').innerText`)).includes('오늘 쓴 돈'));

// 오늘 요약에서 할 일 넣기 → 본 앱
await W.ev(`(() => { const f = document.querySelector('#dayView form[data-form="task"]'); f.title.value = '요약에서 넣은 할 일'; f.requestSubmit(); })()`);
await sleep(700);
ok('오늘 요약에서 넣은 할 일이 본 앱에 보임', (await M.ev(`import('/js/store.js').then(({ store }) => store.byDate('tasks', '${today}').map(t => t.title))`)).includes('요약에서 넣은 할 일'));
// 달력으로 돌아가 날짜 눌러 할 일 넣기
await W.ev(`document.querySelector('.seg [data-view="month"]').click()`);
await sleep(800);
ok('[달력]을 누르면 다시 달력', await W.ev(`document.body.className === 'view-month'`));
await W.ev(`document.querySelector('.day.today').click()`);
await sleep(200);
await W.ev(`(() => { const f = document.querySelector('#sheet form[data-form="task"]'); f.title.value = '달력에서 넣은 할 일'; f.requestSubmit(); })()`);
await sleep(700);
ok('달력에서 넣은 할 일이 본 앱에 보임', (await M.ev(`import('/js/store.js').then(({ store }) => store.byDate('tasks', '${today}').map(t => t.title))`)).includes('달력에서 넣은 할 일'));
await W.ev(`document.querySelector('#sheet [data-close]').click()`);
M.close(); W.close();
