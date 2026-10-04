// 갤럭시 앱(mobile/ 폴더의 Capacitor)에서 열렸는지.
// 앱이 window.Capacitor 를 넣어 주면 그때만 폰 기능(폰 구글 로그인, 폰 알람 알림, 시작 화면)을 켠다.
// 폰·PC 브라우저에서는 window.Capacitor 가 없으므로 아무것도 바뀌지 않는다.
export const isNative = !!window.Capacitor?.isNativePlatform?.();
if (isNative) document.documentElement.classList.add('native-app');

/** 앱에 들어 있는 폰 기능 (없으면 null) */
export const plugin = name => (isNative ? window.Capacitor.Plugins?.[name] || null : null);

// ---- 폰 위쪽 상태 표시줄 색을 담다 화면 색에 맞춘다 (시작 화면이 떠 있으면 보라색) ----
export function syncStatusBar() {
  const SB = plugin('StatusBar');
  if (!SB) return;
  const splash = document.getElementById('bootSplash');
  const onSplash = splash && getComputedStyle(splash).display !== 'none' && !splash.classList.contains('leave');
  const m = (onSplash ? 'rgb(107, 116, 201)' : getComputedStyle(document.querySelector('.app') || document.body).backgroundColor).match(/\d+/g) || [255, 255, 255];
  const [r, g, b] = m.map(Number);
  const hex = '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
  SB.setBackgroundColor({ color: hex }).catch(() => {});
  SB.setStyle({ style: 0.299 * r + 0.587 * g + 0.114 * b > 150 ? 'LIGHT' : 'DARK' }).catch(() => {}); // LIGHT = 밝은 바탕에 어두운 글자
}
if (isNative) {
  window.addEventListener('DOMContentLoaded', () => {
    syncStatusBar();
    new MutationObserver(() => requestAnimationFrame(syncStatusBar)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncStatusBar);
  });
}
