const mode = process.argv[2];
const t = (await (await fetch('http://127.0.0.1:9334/json')).json()).find(t => t.url.startsWith('http://localhost:5500/') && !t.url.includes('__damda'));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); wait.get(d.id)?.(d); };
const ev = e => new Promise(r => { const i = ++id; wait.set(i, d => { if (d.result?.exceptionDetails) console.log('오류', d.result.exceptionDetails.exception?.description); r(d.result?.result?.value); }); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise: true } })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (n, c) => console.log(c ? '✅' : '❌', n);
if (mode === 'add') {
  await ev(`document.querySelector('.desk-tabs [data-screen="tasks"]').click()`); await sleep(400);
  const before = await ev(`document.querySelector('#view-calendar .cell.today').innerText`);
  await ev(`(() => { const i = document.querySelector('#view-tasks .task-input'); i.value = '오른쪽에서 넣은 할 일'; i.closest('form').requestSubmit(); })()`); await sleep(700);
  ok('[할 일] 탭에서 넣은 할 일이 왼쪽 캘린더 칸에 바로 반영', before !== await ev(`document.querySelector('#view-calendar .cell.today').innerText`));
  // 저장 안 한 글자 남겨 두기
  await ev(`(() => { const i = document.querySelector('#view-tasks .task-input'); i.value = '쓰다 만 할 일'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  console.log('쓰다 만 글자 넣음');
} else {
  ok('다시 열면 쓰던 글자가 채워져 있음', await ev(`(document.querySelector('#view-tasks .task-input')?.value || '')`) === '쓰다 만 할 일');
  ok('닫기 전에 넣은 할 일이 저장돼 있음', await ev(`import('/js/store.js').then(({ store }) => store.list('tasks').some(t => t.title === '오른쪽에서 넣은 할 일'))`));
}
ws.close();
