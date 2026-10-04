// 담다 PC 앱 (Electron).
// - 공개 사이트(GitHub Pages)를 그대로 연다 → 사이트를 고치면 PC 앱도 저절로 최신. 한 번 열면 서비스 워커 덕분에 인터넷 없이도 열린다.
// - 담다 화면은 window.desk 가 있으면 PC 화면으로 바뀐다 (js/desk.js). 폰·웹은 영향 없음.
// - 개발할 때: npm run dev → 담다 폴더를 http://localhost:5500 으로 띄워서 연다.
const { app, BrowserWindow, Notification, nativeImage, ipcMain, net, session, screen, globalShortcut, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEV = process.argv.includes('--dev');
const BASE = DEV ? 'http://localhost:5500/' : 'https://crowtit517.github.io/damdanote/';
const DAMDA_DIR = path.join(__dirname, '..'); // 개발할 때 띄울 담다 폴더
// 위젯 페이지는 담다와 같은 주소 아래에 끼워 넣는다 → 같은 저장소(IndexedDB)를 함께 쓴다
const WIDGET_URL = new URL('__damda_widget.html', BASE).href;
const ICON = path.join(__dirname, 'build', 'icon.png');
// 보기마다 기본 크기: 달력 = 크기 조절 가능, 오늘 요약 = 너비 고정·높이는 내용에 맞춤
const VIEWS = { month: { w: 560, h: 620 }, day: { w: 320, h: 520 } };
const BAR_H = 56; // 제목 줄 높이 = 담다 위쪽 줄 높이 (css: --desk-bar-h)
const SPLASH_MIN = 1800; // 시작 화면을 보여 주는 최소 시간 (너무 빨리 사라지면 깜빡임처럼 보여서)

let mainWin = null, widget = null, splash = null, quitting = false, server = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showMain());
// Windows 알림: 설치 전(개발 중)에는 실행 파일 경로를 ID로 써야 알림이 뜬다
app.setAppUserModelId(app.isPackaged ? 'io.github.crowtit517.damda' : process.execPath);
// 구글은 앱 안 브라우저(Electron) 표시가 있으면 로그인을 막기도 해서, 브라우저 이름에서 앱·Electron 표시를 뺀다
app.userAgentFallback = app.userAgentFallback.replace(/ Electron\/\S+/, '').replace(/ [^ ]*damda[^ ]*\/\S+/i, '').replace(/ 담다\/\S+/, '');

// ---- 위젯 상태 기억 (보기, 보기별 위치·크기) ----
const STATE_FILE = () => path.join(app.getPath('userData'), 'widget.json');
let state = { view: 'month', open: false, bounds: {} };
const loadState = () => { try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) }; } catch {} };
const saveState = () => { try { fs.writeFileSync(STATE_FILE(), JSON.stringify(state)); } catch {} };

const appIcon = () => nativeImage.createFromPath(ICON);

async function ensureDevServer() {
  if (!DEV) return;
  try { await net.fetch(BASE); return; } catch {}
  server = spawn('python', ['-m', 'http.server', '5500'], { cwd: DAMDA_DIR, windowsHide: true });
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try { await net.fetch(BASE); return; } catch {}
  }
}

// ---- 위젯은 늘 바탕화면에: 창을 맨 뒤(바탕화면 바로 위)로 보낸다 ----
// Electron에는 이 기능이 없어서, 숨은 PowerShell 하나를 띄워 두고 Windows 기능(SetWindowPos)을 부른다
let psh = null;
function winShell() {
  if (psh && !psh.killed) return psh;
  psh = spawn('powershell', ['-NoProfile', '-NoLogo', '-Command', '-'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  psh.stdin.write('Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class DW { [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f); }\'\n');
  return psh;
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
  widget.setResizable(view === 'month');
  widget.setBounds(boundsFor(view));
  widget.webContents.send('view', view);
}

function openWidget({ focus = true } = {}) {
  if (!widget || widget.isDestroyed()) {
    widget = new BrowserWindow({
      ...boundsFor(state.view), minWidth: 300, minHeight: 200,
      frame: false, transparent: true, resizable: state.view === 'month', skipTaskbar: true, hasShadow: false,
      show: false, title: '담다 위젯', icon: appIcon(),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
    });
    widget.loadURL(WIDGET_URL);
    widget.once('ready-to-show', () => reveal(focus));
    const remember = () => { if (!widget.isDestroyed()) { state.bounds[state.view] = widget.getBounds(); saveState(); } };
    widget.on('moved', remember); widget.on('resized', remember);
    widget.on('blur', sendToBottom); // 위젯을 쓰다가 다른 곳을 누르면 다시 바탕화면 쪽으로
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

// ---- 시작 화면: 둥근 사각형에 "담다 · 하루를 담는 기록장"이 스르륵 나타났다가, 담다가 준비되면 사라진다 ----
function createSplash() {
  splash = new BrowserWindow({
    width: 520, height: 340, frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false, center: true, focusable: false,
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => splash.show());
  splash.on('closed', () => { splash = null; });
}

// 담다 창이 준비되면: 시작 화면을 스르륵 걷고, 담다 창을 투명에서 천천히 보여 준다
let revealed = false;
function revealMain(t0) {
  if (revealed) return;
  revealed = true;
  const go = () => {
    if (!splash || splash.isDestroyed()) return fadeInMain();
    splash.webContents.executeJavaScript("document.body.classList.add('leave')").catch(() => {});
    setTimeout(() => { fadeInMain(); setTimeout(() => splash?.destroy(), 250); }, 520);
  };
  setTimeout(go, Math.max(0, SPLASH_MIN - (Date.now() - t0)));
}

function fadeInMain() {
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.setOpacity(0); mainWin.show();
  let o = 0;
  const step = setInterval(() => {
    if (mainWin.isDestroyed()) return clearInterval(step);
    o = Math.min(1, o + 0.08); mainWin.setOpacity(o);
    if (o >= 1) { clearInterval(step); if (state.open) openWidget({ focus: false }); }
  }, 16);
}

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) createMain();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 600, title: '담다', icon: appIcon(), show: false,
    backgroundColor: '#ffffff', autoHideMenuBar: true,
    // Windows 기본 제목 줄 대신 담다 위쪽 줄이 제목 줄 역할 (— □ ✕ 만 남긴다. 색은 테마에 맞춰 preload가 알려 준다)
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#ffffff', symbolColor: '#2a2d3a', height: BAR_H },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  mainWin.loadURL(BASE);
  // 구글 로그인 창은 앱 안에서 열고, 그 밖의 링크(구글 캘린더에서 열기 등)는 기본 브라우저로
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/accounts\.google\.com\//.test(url)) return { action: 'allow' };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
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
    localStorage.setItem('ple-desk-drafts', JSON.stringify(drafts));
  } catch {}
  window.dispatchEvent(new Event('pagehide')); // 담다가 기기 저장을 마무리한다
  await sleep(300);
  try {
    const sync = await import(new URL('js/sync/engine.js', location.href).href);
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
ipcMain.on('title-bar', (_e, { color, symbolColor }) => {
  try { mainWin?.setTitleBarOverlay({ color, symbolColor, height: BAR_H }); mainWin?.setBackgroundColor(color); } catch {}
});
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

app.whenReady().then(async () => {
  loadState();
  // 위젯 페이지는 desktop/widget.html 을 담다 주소 아래에 끼워서 준다. 나머지는 그대로 보낸다
  const scheme = new URL(BASE).protocol.replace(':', '');
  session.defaultSession.protocol.handle(scheme, req => {
    if (req.url.split(/[?#]/)[0] === WIDGET_URL) {
      return new Response(fs.readFileSync(path.join(__dirname, 'widget.html')), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
  const t0 = Date.now();
  createSplash();
  await ensureDevServer();
  createMain();
  mainWin.once('ready-to-show', () => revealMain(t0));
  setTimeout(() => revealMain(t0), 10000); // 사이트를 못 불러와 준비 신호가 안 와도 10초 뒤엔 담다 창을 연다
  globalShortcut.register('CommandOrControl+Shift+D', toggleWidget);
});

app.on('window-all-closed', () => { if (quitting) app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => { quitting = true; server?.kill(); psh?.kill(); });
