// 고정 수입·지출 화면 (위젯 모형 버전): 요약·진행 막대·상태가 있는 목록 카드, 금액 입력 요청,
// 자주 쓰는 항목(=가계부 카테고리) 칩 · 날짜 칸 · 미리보기 문장이 있는 설정 창, 기록 수정 창.
import { store } from '../store.js';
import { openOverlay, closeOverlay, closeOnBackdrop, isOpen } from '../ui/overlay.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { categoryById, markCategoryUsed } from '../categories.js';
import { chipPickerHtml, bindChipPicker, pickedCategory, bindCategoryLongPress } from './categoryUI.js';
import { shortWon } from './charts.js';
import {
  allRules, dayLabel, pendingAsks, recordAsk, skipAsk, ruleStatus, monthProgress,
  saveRule, togglePause, deleteRule, dueDateOf,
} from '../recurring.js';
import { entryType } from '../ledgerMath.js';
import { escapeHtml, formatWon, formatNumber, parseAmount, keyToDate, todayKey, fullDateLabel, daysBetween, josa } from '../utils.js';

const modal = document.getElementById('recurringModal');
closeOnBackdrop(modal);

const shortDate = key => { const d = keyToDate(key); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
const signed = (type, n) => (type === 'income' ? '+' : '-') + formatNumber(n);
const dayCircle = r => (r.day === 'last' ? '말일' : `${r.day}일`);

// ---- 가계부 탭의 "고정 수입·지출" 카드 (아담한 버전) ----
// 제목 + 작은 추가 버튼 / 한 줄 요약 / 이번 달 진행 / 날짜순 한 줄 목록
const dayNum = r => (r.day === 'last' ? 32 : Number(r.day));

export function recurringCardHtml() {
  const rules = allRules();
  const head = `
    <div class="rule-head">
      <span class="block-title">고정 수입·지출</span>
      <button type="button" class="pill-btn small" data-act="add-rule">＋ 추가</button>
    </div>`;
  if (!rules.length) {
    return `
      <div class="rule-card">
        ${head}
        <p class="empty">월급, 월세, 통신비처럼 매달 같은 날 들어오고 나가는 돈을 등록하면 그날 자동으로 기록돼요.</p>
      </div>`;
  }
  const active = rules.filter(r => !r.paused && !r.askAmount);
  const monthIn = active.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const monthOut = active.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const unknown = rules.filter(r => !r.paused && r.askAmount).length;
  const prog = monthProgress();

  const rows = [...rules].sort((a, b) => dayNum(a) - dayNum(b)).map(r => {
    const st = ruleStatus(r);
    const c = categoryById(r.category, 'ledger');
    return `
      <li><button type="button" class="rule-row${r.paused ? ' paused' : ''}" data-rule-id="${escapeHtml(r.id)}">
        <span class="rule-day">${dayCircle(r)}</span>
        <span class="rule-name">${escapeHtml(r.memo || c.name)}</span>
        <span class="status-pill ${st.key}">${st.key === 'done' ? '✓ ' : ''}${st.label}</span>
        <span class="rule-amount ${r.type}">${r.askAmount ? '<span class="muted small">미정</span>' : signed(r.type, r.amount)}</span>
      </button></li>`;
  }).join('');

  return `
    <div class="rule-card">
      ${head}
      <div class="rule-metrics">
        <div><span class="muted small">매달 수입</span><strong class="income">+${shortWon(monthIn)}</strong></div>
        <div><span class="muted small">매달 지출</span><strong class="expense">-${shortWon(monthOut)}</strong></div>
        <div><span class="muted small">고정 후 남는 돈</span><strong>${monthIn - monthOut < 0 ? '-' : ''}${shortWon(Math.abs(monthIn - monthOut))}</strong></div>
      </div>
      ${unknown ? `<p class="muted small rule-unknown">금액이 매달 다른 항목 ${unknown}개는 위 합계에서 빠져 있어요.</p>` : ''}
      ${prog.total ? `
        <div class="rule-progress"><span>이번 달 기록</span><span class="bar"><i style="width:${(prog.done / prog.total) * 100}%"></i></span><span>${prog.done}/${prog.total}</span></div>` : ''}
      <ul class="rule-list">${rows}</ul>
    </div>`;
}

// ---- "전기요금 얼마였나요?" ----
export function pendingAsksHtml() {
  const list = pendingAsks();
  if (!list.length) return '';
  return `<div class="ask-list">${list.map(o => `
    <form class="ask-form" data-occ="${escapeHtml(o.id)}">
      <div class="ask-text">📝 <strong>${shortDate(o.date)}</strong> · ${escapeHtml(o.rule.memo)} 금액을 입력해주세요</div>
      <div class="ask-row">
        <input class="amount-input" type="text" inputmode="numeric" autocomplete="off" placeholder="금액" aria-label="${escapeHtml(o.rule.memo)} 금액" required />
        <button class="primary-btn">기록</button>
        <button type="button" class="pill-btn" data-act="skip-ask">이번 달 건너뛰기</button>
      </div>
    </form>`).join('')}</div>`;
}

/** 가계부 탭에서 카드·요청 영역의 클릭과 입력을 연결 (한 번만) */
export function bindRecurring(root) {
  root.addEventListener('click', e => {
    const row = e.target.closest('[data-rule-id]');
    if (row) return openRuleEditor(row.dataset.ruleId);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add-rule') return openRuleEditor(null);
    if (act === 'skip-ask') {
      const o = pendingAsks().find(x => x.id === e.target.closest('.ask-form').dataset.occ);
      if (o) { skipAsk(o); toast(`${o.rule.memo} ${shortDate(o.date)}분을 건너뛰었어요`); }
    }
  });
  root.addEventListener('submit', e => {
    if (!e.target.matches('.ask-form')) return;
    e.preventDefault();
    const amount = parseAmount(e.target.querySelector('.amount-input').value);
    const o = pendingAsks().find(x => x.id === e.target.dataset.occ);
    if (!o || !amount) return;
    recordAsk(o, amount);
    toast(`${o.rule.memo} ${formatWon(amount)}을 기록했어요`);
  });
  root.addEventListener('input', commaInput);
}

function commaInput(e) {
  if (!e.target.matches('.amount-input')) return;
  const n = parseAmount(e.target.value);
  e.target.value = n ? formatNumber(n) : '';
}

// ---- 설정 창 ----
let editing = null; // { id, type, day, autoName }

const registeredCategories = exceptId => new Set(allRules().filter(r => r.id !== exceptId && r.category).map(r => r.category));

export function openRuleEditor(id) {
  const rule = id ? store.get('recurring', id) : null;
  const t = keyToDate(todayKey());
  editing = {
    id: rule?.id || null,
    type: rule?.type || 'expense',
    day: rule?.day ?? String(t.getDate()),
    autoName: '',
  };

  modal.innerHTML = `
    <div class="modal-box wide">
      <div class="modal-head">
        <strong>고정 항목 ${rule ? '수정' : '추가'}</strong>
        <button type="button" class="icon-btn close-btn" data-close aria-label="닫기">✕</button>
      </div>
      <form class="rule-form">
        <div class="field-label">종류</div>
        <div class="type-seg" role="radiogroup" aria-label="종류">
          <button type="button" data-type="expense" aria-pressed="${editing.type === 'expense'}">지출</button>
          <button type="button" data-type="income" aria-pressed="${editing.type === 'income'}">수입</button>
        </div>
        <div class="field-label">자주 쓰는 항목 <span class="muted small">(가계부 카테고리 · 누르면 자동 입력)</span></div>
        <div class="rule-picker">${chipPickerHtml('ledger', rule?.category ?? null, { marks: registeredCategories(rule?.id) })}</div>
        <div class="field-label">이름 · 금액</div>
        <div class="two-col">
          <input name="memo" type="text" maxlength="20" placeholder="예: 월세" value="${escapeHtml(rule?.memo || '')}" required />
          <input name="amount" class="amount-input big-amount" type="text" inputmode="numeric" autocomplete="off" placeholder="금액" value="${rule?.amount ? formatNumber(rule.amount) : ''}" />
        </div>
        <label class="check"><input type="checkbox" name="askAmount"${rule?.askAmount ? ' checked' : ''} /> 매달 금액이 달라요 (그날 금액을 물어보기)</label>
        <div class="field-label">매월 며칠</div>
        <div class="day-grid" role="radiogroup" aria-label="날짜"></div>
        <div class="rule-preview" aria-live="polite"></div>
        <label class="check this-month" hidden><input type="checkbox" name="includeThisMonth" /> <span></span></label>
        <p class="form-error" hidden></p>
        <div class="modal-actions">
          ${rule ? `<button type="button" class="pill-btn danger-text" data-act="delete-rule">삭제</button>
                    <button type="button" class="pill-btn" data-act="pause-rule">${rule.paused ? '다시 시작' : '일시정지'}</button>` : '<button type="button" class="pill-btn" data-close>취소</button>'}
          <button class="primary-btn">저장</button>
        </div>
        <p class="muted small rule-note">31일이 없는 달은 말일에 기록돼요. 설정을 바꾸면 앞으로의 기록만 바뀌고, 지난 기록은 그대로예요.</p>
      </form>
    </div>`;
  drawDays();
  syncForm();
  if (!isOpen(modal)) openOverlay({ el: modal, layer: 2, onClose: () => { editing = null; } });
  if (!rule) modal.querySelector('.rule-picker .pick-chip')?.focus();
}

function drawDays() {
  const grid = modal.querySelector('.day-grid');
  if (!grid || !editing) return;
  const days = [...Array.from({ length: 31 }, (_, i) => String(i + 1)), 'last'];
  grid.innerHTML = days.map(d => `
    <button type="button" class="day-cell${d === 'last' ? ' last' : ''}${String(editing.day) === d ? ' on' : ''}" data-day="${d}" aria-pressed="${String(editing.day) === d}">${d === 'last' ? '말일' : d}</button>`).join('');
}

function setType(type) {
  editing.type = type;
  modal.querySelectorAll('.type-seg [data-type]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
}

// 금액 칸, 미리보기 문장, '이번 달분도 기록'을 입력 상태에 맞춘다
function syncForm() {
  const f = modal.querySelector('.rule-form');
  if (!f || !editing) return;
  const ask = f.askAmount.checked;
  f.amount.disabled = ask;
  f.amount.required = !ask;

  const today = todayKey();
  const t = keyToDate(today);
  const thisDue = dueDateOf({ day: editing.day }, t.getFullYear(), t.getMonth());
  const passed = thisDue < today;
  const box = f.querySelector('.this-month');
  box.hidden = !!editing.id || !passed;
  if (!box.hidden) box.querySelector('span').textContent = `이번 달 ${shortDate(thisDue)}분도 지금 기록하기`;

  const include = !box.hidden && f.includeThisMonth.checked;
  const nm = new Date(t.getFullYear(), t.getMonth() + 1, 1); // 12월 다음은 내년 1월
  const next = passed && !include ? dueDateOf({ day: editing.day }, nm.getFullYear(), nm.getMonth()) : thisDue;
  const dd = daysBetween(today, next);
  const name = f.memo.value.trim() || '이름';
  const amount = ask ? '그날 금액을 물어보고' : `${parseAmount(f.amount.value) ? formatWon(parseAmount(f.amount.value)) : '0원'}이`;
  modal.querySelector('.rule-preview').innerHTML = `
    매월 <strong>${editing.day === 'last' ? '말일' : `${editing.day}일`}</strong>에 <strong>${escapeHtml(name)}</strong> ${amount}
    <strong class="${editing.type}">${editing.type === 'income' ? '수입' : '지출'}</strong>${editing.type === 'income' ? '으로' : '로'} 기록돼요
    <span class="muted">다음 기록: ${shortDate(next)}${dd > 0 ? ` (D-${dd})` : dd === 0 ? ' (오늘)' : ' (바로 기록)'}</span>`;
}

// 자주 쓰는 항목 칩: 이름(비어 있거나 자동으로 채운 이름일 때)과 기억해 둔 설정을 채운다
bindChipPicker(modal, id => {
  const f = modal.querySelector('.rule-form');
  if (!f || !editing || !id) return syncForm();
  const c = store.get('categories', id);
  if (!c) return syncForm();
  if (!f.memo.value.trim() || f.memo.value.trim() === editing.autoName) {
    f.memo.value = c.name;
    editing.autoName = c.name;
  }
  const p = c.preset;
  if (p) {
    setType(p.type);
    editing.day = String(p.day);
    f.askAmount.checked = !!p.askAmount;
    f.amount.value = p.amount ? formatNumber(p.amount) : '';
    drawDays();
  }
  syncForm();
});
bindCategoryLongPress(modal);

modal.addEventListener('input', e => { commaInput(e); if (e.target.closest('.rule-form')) syncForm(); });
modal.addEventListener('change', () => syncForm());

modal.addEventListener('click', async e => {
  if (e.target.closest('[data-close]')) return closeOverlay(modal);
  if (!editing) return;
  const tb = e.target.closest('.type-seg [data-type]');
  if (tb) { setType(tb.dataset.type); return syncForm(); }
  const dc = e.target.closest('[data-day]');
  if (dc) { editing.day = dc.dataset.day; drawDays(); return syncForm(); }

  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'pause-rule') {
    const r = store.get('recurring', editing.id);
    togglePause(editing.id);
    toast(`${josa(r.memo, '을', '를')} ${r.paused ? '다시 시작했어요' : '일시정지했어요'}`);
    closeOverlay(modal);
  }
  if (act === 'delete-rule') {
    const r = store.get('recurring', editing.id);
    const ok = await confirmDialog({
      title: `'${r.memo}' 삭제`,
      message: '앞으로 자동 기록을 멈추고 이 고정 항목을 지울까요? 이미 기록된 내역은 그대로 남아요.',
      okLabel: '삭제', danger: true,
    });
    if (!ok) return;
    deleteRule(r.id);
    closeOverlay(modal);
    toast(`'${r.memo}' 고정 항목을 지웠어요`);
  }
});

modal.addEventListener('submit', e => {
  if (e.target.matches('.entry-edit-form')) return submitEntryEdit(e);
  if (!e.target.matches('.rule-form') || !editing) return;
  e.preventDefault();
  const f = e.target;
  const memo = f.memo.value.trim();
  const askAmount = f.askAmount.checked;
  const amount = parseAmount(f.amount.value);
  const err = msg => { const p = f.querySelector('.form-error'); p.textContent = msg; p.hidden = false; };
  if (!memo) return err('이름을 입력해주세요.');
  if (!askAmount && !amount) return err('금액을 입력하거나 "매달 금액이 달라요"를 선택해주세요.');

  const isNew = !editing.id;
  const category = pickedCategory(f);
  const before = store.list('expenses').length;
  markCategoryUsed(category);
  saveRule({
    ...(editing.id ? { id: editing.id } : {}),
    type: editing.type, memo, category,
    amount: askAmount ? null : amount,
    askAmount,
    day: editing.day,
  }, { includeThisMonth: f.includeThisMonth.checked });
  closeOverlay(modal);
  const added = store.list('expenses').length - before;
  toast(isNew ? `고정 항목을 추가했어요${added ? ` · ${added}건 바로 기록` : ''}` : '고정 항목을 수정했어요');
});

// ---- 기록 수정 창 (금액·메모) ----
export function openEntryEditor(id) {
  const e = store.get('expenses', id);
  if (!e) return;
  const t = entryType(e);
  const c = categoryById(e.category, 'ledger');
  editing = null;
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-head">
        <strong>${fullDateLabel(e.date)} ${t === 'income' ? '수입' : '지출'}</strong>
        <button type="button" class="icon-btn close-btn" data-close aria-label="닫기">✕</button>
      </div>
      <form class="entry-edit-form" data-id="${escapeHtml(e.id)}">
        <label class="field"><span>카테고리</span><span>${escapeHtml(c.name)}</span></label>
        <label class="field"><span>금액</span><input name="amount" class="amount-input" type="text" inputmode="numeric" autocomplete="off" value="${formatNumber(e.amount)}" required /></label>
        <label class="field"><span>메모</span><input name="memo" type="text" maxlength="40" value="${escapeHtml(e.memo || '')}" /></label>
        ${e.recurringId ? '<p class="muted small rule-note">고정 항목에서 자동으로 기록된 내역이에요. 여기서 고쳐도 다음 달 설정은 그대로예요.</p>' : ''}
        <div class="modal-actions"><button class="primary-btn">저장</button></div>
      </form>
    </div>`;
  if (!isOpen(modal)) openOverlay({ el: modal, layer: 2 });
  modal.querySelector('input[name="amount"]').select();
}

function submitEntryEdit(e) {
  e.preventDefault();
  const f = e.target;
  const amount = parseAmount(f.amount.value);
  if (!amount) return;
  store.put('expenses', { id: f.dataset.id, amount, memo: f.memo.value.trim() });
  closeOverlay(modal);
  toast('기록을 고쳤어요');
}
