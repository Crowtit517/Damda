// 담다 화면과 위젯이 PC 기능(위젯 열기, 알림, 창 조절)을 부를 수 있게 window.desk 를 넣어 준다.
// window.desk.isApp 이 있으면 담다는 PC 화면으로 바뀐다 (js/desk.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  isApp: true,
  openWidget: () => ipcRenderer.send('open-widget'),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  widget: (act, val) => ipcRenderer.send('widget', act, val),
  onView: fn => ipcRenderer.on('view', (_e, view) => fn(view)),
  // 구글 로그인 (js/sync/google.js 가 PC 앱이면 이쪽을 쓴다)
  googleToken: opts => ipcRenderer.invoke('google-token', opts).catch(e => { throw new Error(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }),
  googleForget: email => ipcRenderer.invoke('google-forget', email || '').catch(() => {}),
});

const isWidget = location.pathname.endsWith('__damda_widget.html');

// ---- 담다 본 창에서만 ----
if (!isWidget) {
  // 제목 줄(— □ ✕) 색을 담다 화면 색(밝게/어둡게)에 맞춘다.
  // 메뉴 같은 창이 열려 어두운 배경이 깔리면, 그 자리도 같은 만큼 어둡게 (Windows가 그리는 곳이라 배경이 덮이지 않는다)
  const rgba = s => { const m = s.match(/[\d.]+/g) || []; return m.length >= 3 ? [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]] : null; };
  const hex = c => '#' + c.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
  const over = (c, top) => c.map((v, i) => (i < 3 ? v * (1 - top[3]) + top[i] * top[3] : v));
  let last = '';
  const syncTitleBar = () => {
    let bg = rgba(getComputedStyle(document.body).backgroundColor);
    let fg = rgba(getComputedStyle(document.body).color);
    if (!bg || !fg) return;
    const open = [...document.querySelectorAll('.modal.open')].sort((a, b) => (+a.style.zIndex || 0) - (+b.style.zIndex || 0));
    for (const m of open) {
      const c = rgba(getComputedStyle(m).backgroundColor);
      if (c && c[3] > 0) { bg = over(bg, c); fg = over(fg, c); }
    }
    const msg = { color: hex(bg), symbolColor: hex(fg) };
    if (msg.color + msg.symbolColor === last) return;
    last = msg.color + msg.symbolColor;
    ipcRenderer.send('title-bar', msg);
  };
  let queued = false;
  const queueSync = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; syncTitleBar(); }); } };

  // 지난번 닫을 때 입력칸에 쓰던 글자를 다시 채운다 (한 번만)
  const restoreDrafts = () => {
    let drafts = [];
    try { drafts = JSON.parse(localStorage.getItem('ple-desk-drafts') || '[]'); localStorage.removeItem('ple-desk-drafts'); } catch {}
    for (const d of drafts) {
      const box = document.getElementById(d.box);
      const el = box && [...box.querySelectorAll(d.tag)].filter(x => (x.name || x.className) === d.name)[d.i];
      if (!el || el.value) continue;
      el.value = d.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  window.addEventListener('load', () => {
    setTimeout(syncTitleBar, 100);
    setTimeout(restoreDrafts, 800);
    // 테마가 바뀌거나 창(.modal)이 열리고 닫힐 때
    new MutationObserver(queueSync).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-theme', 'class'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', queueSync);
  });
}
