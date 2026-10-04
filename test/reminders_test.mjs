// 알림 시간 칸(할 일·반복 할 일)과 알림 계산(js/reminders.js) 시험. headless 크롬(9333) + localhost:5500
import { spawn } from 'child_process';
const p = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${process.env.TEMP}/damda-rem-${Date.now()}`, 'about:blank']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2500);
const t = (await (await fetch('http://127.0.0.1:9333/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(); const errors = [];
ws.onmessage = m => { const d = JSON.parse(m.data); wait.get(d.id)?.(d); if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result; if (r?.exceptionDetails) errors.push('시험 오류: ' + r.exceptionDetails.exception?.description?.split('\n')[0]); return r?.result?.value; };
const ok = (n, c, note = '') => console.log(c ? '✅' : '❌', n, note ? `— ${note}` : '');
await send('Runtime.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://localhost:5500/?tab=tasks' }); await sleep(2500);

// 1) 할 일 알림 칸
ok('할 일 추가 칸 아래에 "⏰ 알림" 칸', await ev(`!!document.querySelector('#view-tasks .task-alarm')`));
await ev(`(() => { const f = document.querySelector('#view-tasks .task-form'); f.querySelector('.task-input').value = '약 먹기'; f.querySelector('.task-alarm').value = '21:30'; f.requestSubmit(); })()`); await sleep(500);
ok('알림 시간을 정한 할 일 저장', await ev(`import('./js/store.js').then(({ store }) => store.list('tasks').some(t => t.title === '약 먹기' && t.alarm === '21:30'))`));
ok('목록에 "⏰ 오후 9:30" 표시', (await ev(`document.getElementById('view-tasks').innerText`)).includes('⏰ 오후 9:30'));
await ev(`(() => { const f = document.querySelector('#view-tasks .task-form'); f.querySelector('.task-input').value = '알림 없는 할 일'; f.requestSubmit(); })()`); await sleep(400);
ok('알림을 비우면 알림 없이 저장', await ev(`import('./js/store.js').then(({ store }) => { const t = store.list('tasks').find(t => t.title === '알림 없는 할 일'); return !!t && !t.alarm; })`));

// 2) 반복 할 일: 회차마다 알림
await ev(`document.querySelector('#view-tasks [data-act="repeat-toggle"]').click()`); await sleep(300);
ok('반복 칸에 알림 줄', await ev(`!!document.querySelector('#view-tasks .repeat-row.alarms .r-alarm')`));
await ev(`document.querySelector('#view-tasks [data-rcount="2"]').click()`); await sleep(200);
ok('하루 2번이면 회차마다 알림 칸 2개 (아침·저녁)', await ev(`document.querySelectorAll('#view-tasks .r-alarm').length === 2 && document.querySelector('#view-tasks .repeat-row.alarms').innerText.includes('아침')`));
await ev(`(() => { const a = document.querySelectorAll('#view-tasks .r-alarm'); a[0].value = '09:00'; a[0].dispatchEvent(new Event('input', { bubbles: true })); })()`);
await ev(`(() => { const f = document.querySelector('#view-tasks .task-form'); f.querySelector('.task-input').value = '비타민'; f.requestSubmit(); })()`); await sleep(500);
const rule = await ev(`import('./js/store.js').then(({ store }) => store.list('taskRules').find(r => r.title === '비타민'))`);
ok('반복 규칙에 회차별 알림 저장 (저녁은 비움)', JSON.stringify(rule?.alarms) === JSON.stringify(['09:00', '']), JSON.stringify(rule?.alarms));
ok('반복 할 일 줄에 "⏰ 오전 9:00"', (await ev(`document.getElementById('view-tasks').innerText`)).includes('⏰ 오전 9:00'));

// 3) 알림 계산
const res = await ev(`(async () => {
  const { store } = await import('./js/store.js');
  const { upcoming } = await import('./js/reminders.js');
  const { todayKey, addDays } = await import('./js/utils.js');
  const T = todayKey(), N = addDays(T, 1), N2 = addDays(T, 2);
  store.put('tasks', { date: N, title: '내일 9시 할 일', alarm: '09:00', done: false });
  store.put('tasks', { date: N, title: '이미 한 할 일', alarm: '09:00', done: true });
  store.put('taskRules', { id: 'rx', title: '물 마시기', times: ['아침', '저녁'], alarms: ['08:00', '20:00'], repeat: { type: 'daily' }, startDate: T });
  store.put('tasks', { id: 'tr_rx_' + N + '_0', ruleId: 'rx', date: N, title: '물 마시기', done: true }); // 내일 아침은 이미 함
  store.put('events', { title: '회의', start: N, end: N, time: '15:00', reminder: 'default' });
  store.put('events', { title: '병원', start: N, end: N, time: '11:00', reminder: '60' });
  store.put('events', { title: '여행', start: N2, end: N2, reminder: '900' });
  store.put('events', { title: '생일', start: N2, end: N2, reminder: 'default' });
  store.put('events', { title: '알림 없음', start: N, end: N, time: '10:00', reminder: 'none' });
  const list = upcoming(new Date(new Date().setHours(0, 0, 0, 0)));
  const f = (title, day) => list.filter(n => n.title.startsWith(title) && (!day || n.at.toLocaleDateString('sv-SE') === day)).map(n => n.at.toLocaleString('sv-SE').slice(5, 16));
  return { N, N2, task: f('내일 9시'), done: f('이미 한'), waterN: f('물 마시기', N), waterN2: f('물 마시기', N2), meet: f('회의'), hosp: f('병원'), trip: f('여행'), bday: f('생일'), none: f('알림 없음'), ids: new Set(list.map(n => n.id)).size === list.length, max: list.length <= 60 };
})()`);
const md = k => k.slice(5);
ok('할 일: 그날 그 시각', JSON.stringify(res.task) === JSON.stringify([`${md(res.N)} 09:00`]), JSON.stringify(res.task));
ok('이미 체크한 할 일은 안 울림', res.done.length === 0);
ok('반복 할 일: 이미 한 회차(내일 아침)는 빼고 저녁만', JSON.stringify(res.waterN) === JSON.stringify([`${md(res.N)} 20:00`]), JSON.stringify(res.waterN));
ok('반복 할 일: 모레는 아침·저녁 둘 다', res.waterN2.length === 2, JSON.stringify(res.waterN2));
ok('일정 기본 알림 = 10분 전', JSON.stringify(res.meet) === JSON.stringify([`${md(res.N)} 14:50`]), JSON.stringify(res.meet));
ok('일정 "1시간 전"', JSON.stringify(res.hosp) === JSON.stringify([`${md(res.N)} 10:00`]), JSON.stringify(res.hosp));
ok('종일 일정 "전날 오전 9시"', JSON.stringify(res.trip) === JSON.stringify([`${md(res.N)} 09:00`]), JSON.stringify(res.trip));
ok('종일 일정 기본 = 그날 오전 9시', JSON.stringify(res.bday) === JSON.stringify([`${md(res.N2)} 09:00`]), JSON.stringify(res.bday));
ok('"알림 없음" 일정은 안 울림', res.none.length === 0);
ok('알림 번호가 겹치지 않음 · 60개 이하', res.ids && res.max);

// 4) 웹(폰 브라우저)에서는 예약하지 않음 (오류 없이 넘어감)
ok('웹에서는 알림 예약 안 함', await ev(`import('./js/native.js').then(n => !n.isNative)`) && await ev(`!document.documentElement.classList.contains('native-app')`));
ok('설정 알림 문구(웹)', (await ev(`(async () => { document.getElementById('menuBtn').click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('#menuModal [data-act="open-settings"]').click(); await new Promise(r => setTimeout(r, 400)); return document.getElementById('settingsModal').innerText; })()`)).includes('갤럭시 담다 앱에서 울려요'));
ok('페이지 오류 없음', errors.length === 0, errors.join(' | '));
ws.close(); p.kill();
