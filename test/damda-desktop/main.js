// 담다 PC 시험판 (Electron). 담다 폴더는 건드리지 않고 http://localhost:5500 을 그대로 연다.
const { app, BrowserWindow, Notification, nativeImage, ipcMain, net, session, screen, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ORIGIN = 'http://localhost:5500';
const DAMDA_DIR = 'C:/Users/User/ple';
// 위젯 페이지는 담다와 같은 주소 아래에 끼워 넣는다 → 같은 저장소(IndexedDB)를 함께 쓴다
const WIDGET_PATH = '/__damda_widget.html';
const PATCHES = require('./desk-patch.js'); // PC 앱에서만 고쳐 보내는 담다 파일
// 보기마다 기본 크기: 달력 = 크기 조절 가능, 오늘 요약 = 너비 고정·높이는 내용에 맞춤
const VIEWS = { month: { w: 560, h: 620 }, day: { w: 320, h: 520 } };

let mainWin = null, widget = null, quitting = false, server = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showMain());
// Windows 알림: 설치 전(개발 중)에는 실행 파일 경로를 ID로 써야 알림이 뜬다
app.setAppUserModelId(app.isPackaged ? 'com.damda.desktop' : process.execPath);

// ---- 위젯 상태 기억 (보기, 보기별 위치·크기) ----
const STATE_FILE = () => path.join(app.getPath('userData'), 'widget.json');
let state = { view: 'month', open: false, bounds: {} };
const loadState = () => { try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) }; } catch {} };
const saveState = () => { try { fs.writeFileSync(STATE_FILE(), JSON.stringify(state)); } catch {} };

function appIcon() {
  const s = 32, buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - s / 2 + .5, y - s / 2 + .5), i = (y * s + x) * 4;
    if (d < s / 2 - 1) { buf[i] = 0x7a; buf[i + 1] = 0xa8; buf[i + 2] = 0x3d; buf[i + 3] = 255; } // BGRA
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}

async function ensureServer() {
  try { await net.fetch(ORIGIN + '/'); return; } catch {}
  server = spawn('python', ['-m', 'http.server', '5500'], { cwd: DAMDA_DIR, windowsHide: true });
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try { await net.fetch(ORIGIN + '/'); return; } catch {}
  }
}

// ---- 위젯은 늘 바탕화면에: 창을 맨 뒤(바탕화면 바로 위)로 보낸다 ----
// Electron에는 이 기능이 없어서, 숨은 PowerShell 하나를 띄워 두고 Windows 기능(SetWindowPos)을 부른다
let shell = null;
function winShell() {
  if (shell && !shell.killed) return shell;
  shell = spawn('powershell', ['-NoProfile', '-NoLogo', '-Command', '-'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  shell.stdin.write('Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class DW { [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f); }\'\n');
  return shell;
}
function sendToBottom() {
  if (!widget || widget.isDestroyed()) return;
  const h = widget.getNativeWindowHandle().readBigInt64LE();
  // HWND_BOTTOM = 1, SWP_NOSIZE|SWP_NOMOVE|SWP_NOACTIVATE = 0x13
  winShell().stdin.write(`[DW]::SetWindowPos([IntPtr]${h}, [IntPtr]1, 0, 0, 0, 0, 0x13) | Out-Null\n`);
}

// 담다 창이 있는 모니터 안에 자리를 잡는다 (저장된 자리가 화면 밖이면 오른쪽 위로)
function boundsFor(view) {
  const v = VIEWS[view], saved = state.bounds[view];
  const ref = mainWin && !mainWin.isDestroyed() && !mainWin.isMinimized() ? mainWin.getBounds() : screen.getCursorScreenPoint();
  const a = (ref.width ? screen.getDisplayMatching(ref) : screen.getDisplayNearestPoint(ref)).workArea;
  const inside = b => b && b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
  if (inside(saved)) return saved;
  const w = v.w, h = Math.min(v.h, a.height - 48);
  return { x: a.x + a.width - w - 24, y: a.y + 24, width: w, height: h };
}

function setView(view) {
  state.view = view; saveState();
  if (!widget || widget.isDestroyed()) return;
  const b = boundsFor(view);
  widget.setResizable(view === 'month');
  widget.setBounds(b);
  widget.webContents.send('view', view);
}

function openWidget({ focus = true } = {}) {
  if (!widget || widget.isDestroyed()) {
    widget = new BrowserWindow({
      ...boundsFor(state.view), minWidth: 300, minHeight: 200,
      frame: false, transparent: true, resizable: state.view === 'month', skipTaskbar: true, hasShadow: false,
      show: false, title: '담다 위젯',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
    });
    widget.loadURL(ORIGIN + WIDGET_PATH);
    widget.once('ready-to-show', () => reveal(focus));
    const remember = () => { if (!widget.isDestroyed()) { state.bounds[state.view] = widget.getBounds(); saveState(); } };
    widget.on('moved', remember); widget.on('resized', remember);
    // 위젯을 쓰다가 다른 곳을 누르면 다시 바탕화면 쪽으로
    widget.on('blur', sendToBottom);
    widget.on('closed', () => { widget = null; });
  } else reveal(focus);
  state.open = true; saveState();
}

// 버튼·단축키로 열면 잠깐 맨 앞에 보여 주고(다른 곳을 누르면 내려감), 앱을 켤 때는 바로 바탕화면에
function reveal(focus) {
  if (focus) { widget.show(); widget.focus(); widget.moveTop(); }
  else { widget.showInactive(); sendToBottom(); }
}

function hideWidget() {
  widget?.hide();
  state.open = false; saveState();
}

const toggleWidget = () => (widget && !widget.isDestroyed() && widget.isVisible() ? hideWidget() : openWidget());

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) createMain();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 600, title: '담다', icon: appIcon(), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'main-preload.js'), contextIsolation: true },
  });
  mainWin.loadURL(ORIGIN + '/');
  // PC 앱 화면: 창 전체가 곧 앱 (담다 화면 위에 덧씌운다)
  mainWin.webContents.on('dom-ready', () => {
    try { mainWin.webContents.insertCSS(fs.readFileSync(path.join(__dirname, 'desk.css'), 'utf8')); } catch {}
  });
  // X를 누르면: 저장을 마무리하고(쓰던 글자 포함, 드라이브는 최대 3초) 위젯까지 모두 끝낸다
  mainWin.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    saveAndQuit();
  });
}

// 담다 화면 안에서 실행: 쓰던 글자 → 기기 저장 마무리 → 드라이브에 올릴 것이 있으면 올리기
const BEFORE_QUIT = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    const drafts = [];
    document.querySelectorAll('.app input, .app textarea, #dayPanel input, #dayPanel textarea').forEach(el => {
      if (!el.value || ['checkbox', 'radio', 'hidden', 'range', 'color', 'date', 'month'].includes(el.type)) return;
      const box = el.closest('[id]');
      const same = [...box.querySelectorAll(el.tagName)].filter(x => (x.name || x.className) === (el.name || el.className));
      drafts.push({ box: box.id, tag: el.tagName, name: el.name || el.className, i: same.indexOf(el), value: el.value });
    });
    localStorage.setItem('desk-drafts', JSON.stringify(drafts));
  } catch {}
  window.dispatchEvent(new Event('pagehide')); // 담다가 기기 저장을 마무리한다
  await sleep(300);
  try {
    const sync = await import('/js/sync/engine.js');
    if (sync.isConnected()) await Promise.race([sync.syncNow(), sleep(3000)]);
  } catch {}
  return true;
})()`;

async function saveAndQuit() {
  try {
    await Promise.race([mainWin.webContents.executeJavaScript(BEFORE_QUIT), new Promise(r => setTimeout(r, 4000))]);
  } catch {}
  app.quit();
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: appIcon(), silent: true }); // PC는 소리 없이
  n.on('click', showMain);
  n.show();
}

ipcMain.on('notify', (_e, { title, body }) => notify(title, body));
ipcMain.on('open-widget', () => openWidget());
ipcMain.on('widget', (_e, act, val) => {
  if (!widget || widget.isDestroyed()) return;
  if (act === 'hide') hideWidget();
  if (act === 'open-main') showMain();
  if (act === 'hello') widget.webContents.send('view', state.view);
  if (act === 'view' && VIEWS[val] && val !== state.view) setView(val);
  // 오늘 요약은 너비 고정, 높이만 내용에 맞춘다
  if (act === 'height' && state.view === 'day') {
    const b = widget.getBounds();
    widget.setBounds({ ...b, width: VIEWS.day.w, height: Math.max(200, Math.min(800, Math.round(val))) });
  }
});

async function patched(req, pairs) {
  const res = await net.fetch(req, { bypassCustomProtocolHandlers: true });
  let text = await res.text();
  const missing = pairs.filter(([a]) => !text.includes(a));
  if (missing.length) { console.log('PATCH_SKIP', new URL(req.url).pathname, missing.length); return new Response(text, { headers: { 'content-type': 'text/javascript; charset=utf-8' } }); }
  for (const [a, b] of pairs) text = text.replace(a, () => b);
  return new Response(text, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
}

app.whenReady().then(async () => {
  loadState();
  // 예전에 받아 둔(고치기 전) 담다 파일을 쓰지 않도록 앱 캐시를 비운다
  await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
  // 위젯 페이지만 시험판 폴더에서 주고, 나머지는 담다 서버로 그대로 보낸다
  session.defaultSession.protocol.handle('http', req => {
    const u = new URL(req.url);
    if (u.origin === ORIGIN && u.pathname === WIDGET_PATH) {
      return new Response(fs.readFileSync(path.join(__dirname, 'widget.html')), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (u.origin === ORIGIN && PATCHES[u.pathname]) return patched(req, PATCHES[u.pathname]);
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
  await ensureServer();
  createMain();
  if (state.open) mainWin.once('ready-to-show', () => openWidget({ focus: false }));
  globalShortcut.register('CommandOrControl+Shift+D', toggleWidget);
});

app.on('window-all-closed', () => { if (quitting) app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => { quitting = true; server?.kill(); shell?.kill(); });
