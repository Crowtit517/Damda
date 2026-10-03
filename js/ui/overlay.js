// 패널·선택 창·모달 여닫기를 한 곳에서 관리한다 (docs/ui.md 6장).
// - ✕, 바깥 클릭, Esc, 안드로이드 뒤로가기로 닫힌다.
// - Esc/뒤로가기는 맨 위 창부터 하나씩 닫는다.
// - 같은 층(layer) 이상의 창이 열려 있으면 새 창을 열 때 닫는다.
// - 창이 하나라도 열려 있으면 history 기록을 하나 쌓아, 뒤로가기가 앱을 끄지 않고 창을 닫게 한다.

const scrim = document.getElementById('scrim');
const stack = [];
let hasEntry = false;
let ignorePop = false;

const CLOSE_MS = 260;

function show(o) {
  const el = o.el;
  clearTimeout(el._hideTimer);
  // 나중에 연 창이 항상 위에 오도록 (모달끼리 높이가 같으면 HTML 순서대로 겹쳐 뒤에 숨는 문제 방지).
  // 이미 다른 모달 위에 열리는 모달은 배경을 옅게 해서 화면이 두 겹으로 어두워지지 않게 한다.
  if (el.classList.contains('modal')) {
    el.style.zIndex = String(70 + stack.length * 2);
    el.classList.toggle('stacked', stack.some(x => x !== o && x.el.classList.contains('modal')));
  }
  el.hidden = false;
  void el.offsetWidth; // 애니메이션이 시작되도록 한 번 그린 뒤 open 추가
  el.classList.add('open');
}

function hide(o) {
  const el = o.el;
  el.classList.remove('open');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, CLOSE_MS);
  o.onClose?.();
}

function sync() {
  const needScrim = stack.some(o => o.scrim);
  if (needScrim) {
    clearTimeout(scrim._hideTimer);
    scrim.hidden = false;
    void scrim.offsetWidth;
    scrim.classList.add('open');
  } else {
    scrim.classList.remove('open');
    scrim._hideTimer = setTimeout(() => { if (!scrim.classList.contains('open')) scrim.hidden = true; }, CLOSE_MS);
  }

  if (stack.length && !hasEntry) {
    history.pushState({ pleOverlay: true }, '');
    hasEntry = true;
  } else if (!stack.length && hasEntry) {
    hasEntry = false;
    ignorePop = true;
    history.back();
  }
}

/** o: { el, layer = 1, scrim = false, onClose } */
export function openOverlay(o) {
  if (isOpen(o.el)) return;
  o = { layer: 1, scrim: false, ...o };
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].layer >= o.layer) hide(stack.splice(i, 1)[0]);
  }
  stack.push(o);
  show(o);
  sync();
}

export function closeOverlay(el) {
  const i = stack.findIndex(o => o.el === el);
  if (i < 0) return;
  stack.splice(i).reverse().forEach(hide);
  sync();
}

export function toggleOverlay(o) {
  if (isOpen(o.el)) closeOverlay(o.el);
  else openOverlay(o);
}

export function closeTop() {
  const o = stack.pop();
  if (!o) return false;
  hide(o);
  sync();
  return true;
}

export const isOpen = el => stack.some(o => o.el === el);
export const topOverlay = () => stack[stack.length - 1]?.el || null;

/** 모달 바깥(어두운 배경) 클릭 시 닫기 */
export function closeOnBackdrop(el) {
  el.addEventListener('click', e => { if (e.target === el) closeOverlay(el); });
}

scrim.addEventListener('click', () => closeTop());

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && closeTop()) e.preventDefault();
});

window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  hasEntry = false;
  const o = stack.pop();
  if (o) hide(o);
  sync();
});
