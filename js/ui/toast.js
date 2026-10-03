// 하단 알림 + 실행 취소.
// 되돌리기가 있는 알림은 남은 시간을 가는 막대로 보여준다.
import { store } from '../store.js';
import { escapeHtml } from '../utils.js';

const el = document.getElementById('toast');
let timer = null;

/** action: { label, run }, duration: 보여줄 시간(ms) */
export function toast(message, action, duration = action ? 6000 : 3500) {
  el.innerHTML = `
    <span class="toast-text">${escapeHtml(message)}</span>
    ${action ? `<button type="button" class="toast-action"><span aria-hidden="true">↺</span> ${escapeHtml(action.label)}</button>` : ''}
    ${action ? `<i class="toast-timer" style="animation-duration:${duration}ms"></i>` : ''}`;
  if (action) el.querySelector('button').addEventListener('click', () => { action.run(); hideToast(); });
  clearTimeout(el._hideTimer);
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add('open');
  clearTimeout(timer);
  timer = setTimeout(hideToast, duration);
}

function hideToast() {
  el.classList.remove('open');
  el._hideTimer = setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, 250);
}

/** 삭제하고 "되돌리기"를 띄운다 */
export function removeWithUndo(collection, ids, message = '삭제했어요') {
  const list = Array.isArray(ids) ? ids : [ids];
  store.batch(() => list.forEach(id => store.remove(collection, id)));
  toast(message, { label: '되돌리기', run: () => store.batch(() => list.forEach(id => store.restore(collection, id))) });
}
