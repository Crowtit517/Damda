// 시작 화면(홈 화면에 설치한 앱으로 열 때만 보임)을 담다가 준비되면 스르륵 걷어낸다.
// 처음 켤 때는 최소 1.8초 보여 주고, 같은 실행 안에서 새로고침하면 바로 걷어낸다.
// 앱 코드가 멈춰도 css가 6초 뒤에 스스로 숨긴다.
const SEEN_KEY = 'ple-boot-seen';
const MIN_MS = 1800; // PC 시작 화면과 같은 길이

export function hideBootSplash() {
  const el = document.getElementById('bootSplash');
  if (!el) return;
  if (getComputedStyle(el).display === 'none') { el.remove(); return; }
  let seen = false;
  try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; sessionStorage.setItem(SEEN_KEY, '1'); } catch {}
  const wait = seen ? 0 : Math.max(0, MIN_MS - performance.now());
  setTimeout(() => {
    el.classList.add('leave');
    setTimeout(() => el.remove(), 550);
  }, wait);
}
