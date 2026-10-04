import fs from 'fs';
const t = (await (await fetch('http://127.0.0.1:9334/json')).json()).find(t => t.url.startsWith('http://localhost:5500/') && !t.url.includes('__damda'));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
ws.onmessage = m => { const v = JSON.parse(m.data).result?.result?.value; fs.writeFileSync('prototype-data.json', JSON.stringify(v, null, 2)); console.log('항목 수:', Object.entries(v.data).map(([k, o]) => k + ' ' + Object.keys(o).length).join(', ')); ws.close(); };
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `import('/js/store.js').then(({ store }) => ({ note: 'PC 시험판(Electron, localhost:5500)에서 시험할 때 쓴 데이터 (2026-10-04)', data: store.exportData(), localStorage: Object.fromEntries(Object.keys(localStorage).filter(k => !/token|gtoken|gcal-extra/i.test(k)).map(k => [k, localStorage.getItem(k)])) }))`, awaitPromise: true, returnByValue: true } }));
