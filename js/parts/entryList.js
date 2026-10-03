// 가계부 기록 부품 (지출·수입). 가계부 탭과 하루 패널이 같은 코드를 쓴다.
// 카테고리는 지출·수입 공통인 가계부 목록 하나에서 칩으로 고른다.
// 금액·날짜·카테고리·메모만 저장한다 (docs/data-sync.md 5장).
import { store } from '../store.js';
import { removeWithUndo } from '../ui/toast.js';
import { categoryById, markCategoryUsed } from '../categories.js';
import { chipPickerHtml, bindChipPicker, pickedCategory, bindCategoryLongPress } from './categoryUI.js';
import { entryType } from '../ledgerMath.js';
import { openEntryEditor } from './recurringUI.js';
import { escapeHtml, formatWon, formatNumber, parseAmount, sumAmounts, loadPref, savePref } from '../utils.js';

const LAST_CAT_KEY = 'ple-last-ledger-category';
const types = new Map(); // container.id → 'expense' | 'income'
let refocusId = null;

export function renderEntries(container, key, opts = {}) {
  container.dataset.key = key;
  container._opts = opts;
  if (!container.dataset.bound) { bind(container); container.dataset.bound = '1'; }

  const type = types.get(container.id) || 'expense';
  const list = store.byDate('expenses', key).sort((a, b) => a.createdAt - b.createdAt);
  const spent = sumAmounts(list.filter(e => entryType(e) === 'expense'));
  const earned = sumAmounts(list.filter(e => entryType(e) === 'income'));

  let html = '';
  if (opts.showDayTotal) {
    html += `<div class="day-total">이날 <span>지출 <strong>${formatWon(spent)}</strong></span>${earned ? `<span>수입 <strong>${formatWon(earned)}</strong></span>` : ''}</div>`;
  }

  html += `
    <form class="entry-form">
      ${chipPickerHtml('ledger', loadPref(LAST_CAT_KEY, null))}
      <div class="input-row">
        <div class="type-toggle" role="radiogroup" aria-label="종류">
          <button type="button" data-type="expense" aria-pressed="${type === 'expense'}">지출</button>
          <button type="button" data-type="income" aria-pressed="${type === 'income'}">수입</button>
        </div>
        <input class="amount-input" type="text" inputmode="numeric" autocomplete="off" placeholder="금액" aria-label="금액" required />
        <input class="memo-input" type="text" maxlength="40" placeholder="메모 (선택)" aria-label="메모" />
        <button class="primary-btn">추가</button>
      </div>
    </form>
    <p class="form-hint">🔒 금액·날짜·메모만 저장돼요. 카드·계좌번호는 적지 마세요.</p>`;

  html += list.length
    ? `<ul class="entry-list">${list.map(e => {
        const t = entryType(e);
        const c = categoryById(e.category, 'ledger');
        return `
          <li class="entry" data-id="${escapeHtml(e.id)}" title="눌러서 금액·메모 고치기">
            <span class="badge slot-${c.slot}"${c.id ? ` data-cat-id="${escapeHtml(c.id)}" data-cat-kind="ledger"` : ''}>${escapeHtml(c.name)}</span>
            <span class="entry-memo">${e.memo ? escapeHtml(e.memo) : '<span class="muted">메모 없음</span>'}${e.recurringId ? ' <span class="rec-tag" title="고정 항목에서 자동 기록">고정</span>' : ''}</span>
            <span class="entry-amount ${t}">${t === 'income' ? '+' : '-'}${formatWon(e.amount)}</span>
            <button type="button" class="del-btn" data-act="delete" aria-label="삭제">✕</button>
          </li>`;
      }).join('')}</ul>`
    : '<p class="empty">이날 기록이 없어요.</p>';

  container.innerHTML = html;
  if (refocusId === container.id) {
    container.querySelector('.amount-input')?.focus();
    refocusId = null;
  }
}

function bind(container) {
  const rerender = () => renderEntries(container, container.dataset.key, container._opts);
  bindCategoryLongPress(container);
  bindChipPicker(container, id => savePref(LAST_CAT_KEY, id));

  // 입력하는 동안 천 단위 콤마
  container.addEventListener('input', e => {
    if (!e.target.matches('.amount-input')) return;
    const n = parseAmount(e.target.value);
    e.target.value = n ? formatNumber(n) : '';
  });

  container.addEventListener('click', e => {
    const tb = e.target.closest('[data-type]');
    if (tb) { types.set(container.id, tb.dataset.type); return rerender(); }
    if (e.target.closest('[data-act]')?.dataset.act === 'delete') {
      return removeWithUndo('expenses', e.target.closest('.entry').dataset.id, '기록을 삭제했어요');
    }
    const row = e.target.closest('.entry');
    if (row) openEntryEditor(row.dataset.id);
  });

  container.addEventListener('submit', e => {
    if (!e.target.matches('.entry-form')) return;
    e.preventDefault();
    const amount = parseAmount(e.target.querySelector('.amount-input').value);
    if (!amount) return;
    const type = types.get(container.id) || 'expense';
    const category = pickedCategory(e.target);
    const memo = e.target.querySelector('.memo-input').value.trim();
    refocusId = container.id;
    markCategoryUsed(category);
    store.put('expenses', { date: container.dataset.key, type, category, amount, memo });
  });
}
