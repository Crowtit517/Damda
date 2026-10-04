const t = (await (await fetch('http://127.0.0.1:9334/json')).json()).find(t => t.type === 'page' && !t.url.includes('__damda'));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
await new Promise(res => { ws.onmessage = m => { console.log('테마:', JSON.parse(m.data).result?.result?.value); res(); }; ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `document.getElementById('themeToggle').click(); new Promise(r => setTimeout(() => r(document.documentElement.dataset.theme), 500))`, awaitPromise: true, returnByValue: true } })); });
ws.close();
