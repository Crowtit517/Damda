// 확인 창 (브라우저 기본 confirm 대신). overlay 규칙을 따르므로 Esc·뒤로가기·바깥 클릭으로 닫히면 '취소'.
import { openOverlay, closeOverlay, closeOnBackdrop } from './overlay.js';
import { escapeHtml } from '../utils.js';

const el = document.getElementById('dialogModal');
closeOnBackdrop(el);
let resolver = null;

/** 여러 선택지. choices: [{ label, value, danger? }] → 고른 value, 취소면 null */
export function choiceDialog({ title, message, choices, cancelLabel = '취소' }) {
  if (resolver) resolver(null);
  el.innerHTML = `
    <div class="modal-box">
      <div class="modal-head"><strong>${escapeHtml(title)}</strong></div>
      <p class="dialog-message">${escapeHtml(message)}</p>
      <div class="modal-actions${choices.length > 1 ? ' stacked' : ''}">
        <button type="button" class="pill-btn" data-answer="">${escapeHtml(cancelLabel)}</button>
        ${choices.map((c, i) => `<button type="button" class="${i === choices.length - 1 ? 'primary-btn' : 'pill-btn'}${c.danger ? ' danger' : ''}" data-answer="${escapeHtml(c.value)}">${escapeHtml(c.label)}</button>`).join('')}
      </div>
    </div>`;
  return new Promise(resolve => {
    resolver = resolve;
    openOverlay({
      el, layer: 4,
      onClose: () => { if (resolver) { const r = resolver; resolver = null; r(null); } },
    });
    el.querySelector('.primary-btn')?.focus();
  });
}

export async function confirmDialog({ title, message, okLabel = '확인', cancelLabel = '취소', danger = false }) {
  const v = await choiceDialog({ title, message, cancelLabel, choices: [{ label: okLabel, value: 'yes', danger }] });
  return v === 'yes';
}

el.addEventListener('click', e => {
  const btn = e.target.closest('[data-answer]');
  if (!btn) return;
  const r = resolver;
  resolver = null;
  closeOverlay(el);
  r?.(btn.dataset.answer || null);
});
