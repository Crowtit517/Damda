// PC 앱 시작 화면 시험판: 둥근 사각형이 스르륵 나타나 "담다 / 하루를 담는 기록장"을 보여 주고,
// 뒤에서 담다가 준비되면 스르륵 사라지며 담다 창이 열린다. (정식 앱 desktop/ 에는 아직 넣지 않음)
// 실행: desktop/node_modules/electron/dist/electron.exe test/splash-demo
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const SITE = 'https://crowtit517.github.io/damdanote/';
const MIN_SHOW = 1800; // 시작 화면을 보여 주는 최소 시간 (너무 빨리 사라지면 깜빡임처럼 보여서)

app.whenReady().then(() => {
  const t0 = Date.now();
  const splash = new BrowserWindow({
    width: 520, height: 340, frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false, center: true,
    webPreferences: { preload: path.join(__dirname, 'splash-preload.js') },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => {
    splash.show();
    // 시험용: SPLASH_SHOT=1 이면 단계별 사진을 남긴다
    if (process.env.SPLASH_SHOT) for (const [ms, name] of [[120, '1-start'], [450, '2-appear'], [1100, '3-shown']]) {
      setTimeout(async () => require('fs').writeFileSync(path.join(__dirname, `splash-${name}.png`), (await splash.webContents.capturePage()).toPNG()), ms);
    }
  });

  const main = new BrowserWindow({
    width: 1280, height: 820, show: false, title: '담다', backgroundColor: '#ffffff',
    icon: path.join(__dirname, '../../desktop/build/icon.png'),
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#ffffff', symbolColor: '#2a2d3a', height: 56 },
    webPreferences: { preload: path.join(__dirname, '../../desktop/preload.js') },
  });
  main.loadURL(SITE);

  main.once('ready-to-show', () => {
    setTimeout(() => {
      splash.webContents.send('leave'); // 스르륵 사라지기 시작
      if (process.env.SPLASH_SHOT) setTimeout(async () => require('fs').writeFileSync(path.join(__dirname, 'splash-4-leave.png'), (await splash.webContents.capturePage()).toPNG()), 230);
      setTimeout(() => {
        // 담다 창은 투명에서 천천히 나타난다
        main.setOpacity(0); main.show();
        let o = 0;
        const fade = setInterval(() => { o = Math.min(1, o + 0.08); main.setOpacity(o); if (o >= 1) clearInterval(fade); }, 16);
        setTimeout(() => splash.destroy(), 250);
      }, 520);
    }, Math.max(0, MIN_SHOW - (Date.now() - t0)));
  });
  main.on('closed', () => app.quit());
});
