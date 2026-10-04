// 서비스 워커: 앱 파일을 저장해 두고 인터넷이 없어도 열리게 한다.
// 같은 출처 파일은 '네트워크 먼저'(항상 최신, 실패 시 저장본), 폰트는 '저장본 먼저'.
const CACHE = 'damda-shell-v26';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/app.js', './js/config.js', './js/settings.js', './js/sync/google.js', './js/sync/drive.js', './js/sync/engine.js', './js/sync/gcal.js', './js/store.js', './js/db.js', './js/utils.js', './js/categories.js', './js/ledgerMath.js', './js/sample.js', './js/recurring.js', './js/taskRepeat.js',
  './js/ui/overlay.js', './js/ui/toast.js', './js/ui/dialog.js',
  './js/parts/dateNav.js', './js/parts/taskList.js', './js/parts/entryList.js', './js/parts/categoryUI.js', './js/parts/charts.js', './js/parts/recurringUI.js', './js/parts/repeatUI.js', './js/parts/guide.js', './js/parts/eventForm.js', './js/parts/eventEditor.js',
  './js/views/calendar.js', './js/views/dayPanel.js', './js/views/tasks.js', './js/views/ledger.js',
  './icons/icon-192.png', './icons/icon-512.png',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
    );
  } else if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }))
    );
  }
});
