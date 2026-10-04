// 담다 화면과 위젯이 PC 기능(위젯 열기, 알림, 창 조절)을 부를 수 있게 window.desk 를 넣어 준다.
// window.desk.isApp 이 있으면 담다는 PC 화면으로 바뀐다 (js/desk.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  isApp: true,
  openWidget: () => ipcRenderer.send('open-widget'),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  widget: (act, val) => ipcRenderer.send('widget', act, val),
  onView: fn => ipcRenderer.on('view', (_e, view) => fn(view)),
});

const isWidget = location.pathname.endsWith('__damda_widget.html');

// ---- 담다 본 창에서만 ----
if (!isWidget) {
  // 제목 줄(— □ ✕) 색을 담다 화면 색(밝게/어둡게)에 맞춘다
  const hex = rgb => {
    const m = rgb.match(/\d+(\.\d+)?/g);
    return m ? '#' + m.slice(0, 3).map(n => Math.round(+n).toString(16).padStart(2, '0')).join('') : null;
  };
  const syncTitleBar = () => {
    const bg = hex(getComputedStyle(document.body).backgroundColor);
    const fg = hex(getComputedStyle(document.body).color);
    if (bg && fg) ipcRenderer.send('title-bar', { color: bg, symbolColor: fg });
  };

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
    new MutationObserver(() => setTimeout(syncTitleBar, 50))
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(syncTitleBar, 50));
  });
}
