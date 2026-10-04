// PC 앱 전용: 오른쪽 구역 위쪽의 [이 날 | 할 일 | 가계부] 탭과, 경계를 끌어 넓이를 바꾸는 손잡이.
// 캘린더는 늘 왼쪽에 보이고, 오른쪽 구역은 창의 1/3까지만 넓어진다 (docs/ui.md 9장).
const WIDTH_KEY = 'ple-desk-side-w';
const MIN_W = 300;

export function mountDeskSide(showTab) {
  const root = document.documentElement;
  try { const w = Number(localStorage.getItem(WIDTH_KEY)); if (w) root.style.setProperty('--desk-side-w', w + 'px'); } catch {}

  const nav = document.createElement('nav');
  nav.className = 'desk-tabs';
  nav.setAttribute('role', 'tablist');
  nav.innerHTML = [['calendar', '이 날'], ['tasks', '할 일'], ['ledger', '가계부']]
    .map(([k, label]) => `<button type="button" role="tab" data-screen="${k}">${label}</button>`).join('');
  nav.addEventListener('click', e => {
    const b = e.target.closest('[data-screen]');
    if (b) showTab(b.dataset.screen);
  });

  const bar = document.createElement('div');
  bar.className = 'desk-resizer';
  bar.title = '끌어서 넓이 조절';
  bar.addEventListener('pointerdown', e => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const move = ev => {
      const w = Math.round(Math.min(Math.max(innerWidth - ev.clientX, MIN_W), innerWidth / 3));
      root.style.setProperty('--desk-side-w', w + 'px');
      try { localStorage.setItem(WIDTH_KEY, w); } catch {}
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', () => bar.removeEventListener('pointermove', move), { once: true });
  });

  document.body.append(nav, bar);
}

/** 지금 오른쪽 구역에 보이는 탭 표시 */
export function markDeskTab(tab) {
  document.querySelectorAll('.desk-tabs [data-screen]').forEach(b => {
    const on = b.dataset.screen === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
  });
}
