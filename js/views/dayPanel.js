// 하루 통합 패널: 캘린더에서 날짜를 누르면 PC는 오른쪽, 모바일은 아래에서 스르륵 나온다.
// 할 일은 체크만 하는 목록, 가계부는 요약만 보여주고 누르면 각 탭의 그 날짜로 넘어간다 (패널은 가볍게).
import { store } from '../store.js';
import { openOverlay, closeOverlay, isOpen } from '../ui/overlay.js';
import { removeWithUndo } from '../ui/toast.js';
import { dateNavHtml, bindDateNav } from '../parts/dateNav.js';
import { renderTasks, categoryCardsHtml, progressOf } from '../parts/taskList.js';
import { tasksOn } from '../taskRepeat.js';
import { bindCategoryLongPress } from '../parts/categoryUI.js';
import { onlyExpenses, entryType } from '../ledgerMath.js';
import { categoryById } from '../categories.js';
import { getSetting } from '../settings.js';
import * as gcal from '../sync/gcal.js';
import {
  addDays, daysBetween, escapeHtml, formatTime, formatWon, sumAmounts,
  EVENT_COLORS, safeColor, isValidKey, loadPref, savePref,
} from '../utils.js';

const SECTIONS_KEY = 'ple-panel-sections';
const el = document.getElementById('dayPanel');
let key = null;

el.innerHTML = `
  <div class="sheet-handle" aria-hidden="true"><i></i></div>
  <header class="panel-head">
    <div class="nav-slot"></div>
    <button type="button" class="icon-btn close-btn" data-close aria-label="닫기">✕</button>
  </header>
  <div class="panel-body">
    <div class="summary-slot"></div>
    <details class="section" data-sec="events"><summary>📅 일정 <span class="sec-meta"></span></summary><div class="section-body events-slot"></div></details>
    <details class="section" data-sec="tasks"><summary>✅ 할 일 <span class="sec-meta"></span></summary>
      <div class="section-body"><div id="panelTasks"></div><button type="button" class="goto-btn" data-goto="tasks">할 일에서 추가·편집 <span aria-hidden="true">›</span></button></div></details>
    <details class="section" data-sec="expenses"><summary>💰 가계부 <span class="sec-meta"></span></summary>
      <div class="section-body"><div id="panelExpenses"></div><button type="button" class="goto-btn" data-goto="ledger">가계부에서 기록하기 <span aria-hidden="true">›</span></button></div></details>
  </div>`;

const navSlot = el.querySelector('.nav-slot');
const summarySlot = el.querySelector('.summary-slot');
const eventsSlot = el.querySelector('.events-slot');
const tasksSlot = el.querySelector('#panelTasks');
const expensesSlot = el.querySelector('#panelExpenses');

// 섹션 접힘 상태 기억 (기본: 모두 펼침)
const sectionState = loadPref(SECTIONS_KEY, {});
el.querySelectorAll('.section').forEach(s => { s.open = sectionState[s.dataset.sec] !== false; });
el.addEventListener('toggle', e => {
  if (!e.target.matches('.section')) return;
  sectionState[e.target.dataset.sec] = e.target.open;
  savePref(SECTIONS_KEY, sectionState);
}, true);

export const currentPanelKey = () => key;

const notifyChange = () => window.dispatchEvent(new CustomEvent('ple:panelchange'));

export function openDayPanel(k) {
  key = k;
  render();
  if (!isOpen(el)) {
    el.querySelector('.panel-body').scrollTop = 0;
    openOverlay({ el, layer: 1, scrim: true, onClose: () => { key = null; notifyChange(); } });
  }
  notifyChange();
}

export const isPanelOpen = () => isOpen(el);

export function shiftDay(n) {
  if (key) openDayPanel(addDays(key, n));
}

export function render() {
  if (!key) return;
  const tasks = tasksOn(key);
  const p = progressOf(tasks);
  const entries = store.byDate('expenses', key).sort((a, b) => a.createdAt - b.createdAt);
  const spent = sumAmounts(onlyExpenses(entries));
  const earned = sumAmounts(entries.filter(e => entryType(e) === 'income'));
  const events = [...store.eventsOn(key), ...gcal.eventsOn(key)].sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  navSlot.innerHTML = dateNavHtml(key);
  summarySlot.innerHTML = `
    <div class="summary">
      <div class="summary-top">
        <div>
          <div class="muted">할 일</div>
          <div class="big">${p.done}/${p.total} 완료 (${p.pct}%)</div>
        </div>
        ${getSetting('money') ? `<div class="summary-right">
          <div class="muted">이날 지출</div>
          <div class="big accent">${formatWon(spent)}</div>
        </div>` : ''}
      </div>
      <div class="bar"><i style="width:${p.pct}%"></i></div>
      ${categoryCardsHtml(tasks)}
    </div>`;

  el.querySelector('[data-sec="events"] .sec-meta').textContent = events.length ? `${events.length}개` : '';
  el.querySelector('[data-sec="tasks"] .sec-meta').textContent = p.total ? `${p.done}/${p.total}` : '';
  el.querySelector('[data-sec="expenses"] .sec-meta').textContent = spent && getSetting('money') ? `지출 ${formatWon(spent)}` : '';

  renderEvents(events);
  renderTasks(tasksSlot, key, { checklist: true });
  renderLedgerSummary(entries, spent, earned);
}

// 가계부는 읽기만: 합계 + 최근 기록 몇 개. 누르면 가계부 탭의 이 날짜로
function renderLedgerSummary(entries, spent, earned) {
  if (!getSetting('money')) {
    expensesSlot.innerHTML = '<button type="button" class="ledger-mini hidden-money" data-goto="ledger"><span>🙈 금액을 숨겼어요</span><span class="muted small">가계부에서 보기 ›</span></button>';
    return;
  }
  if (!entries.length) { expensesSlot.innerHTML = '<p class="empty">이날 기록이 없어요.</p>'; return; }
  const MAX = 4;
  expensesSlot.innerHTML = `
    <button type="button" class="ledger-mini" data-goto="ledger">
      <span class="ledger-mini-totals">
        <span>지출 <strong class="expense">-${formatWon(spent)}</strong></span>
        ${earned ? `<span>수입 <strong class="income">+${formatWon(earned)}</strong></span>` : ''}
      </span>
      <span class="ledger-mini-list">
        ${entries.slice(0, MAX).map(e => {
          const t = entryType(e);
          const c = categoryById(e.category, 'ledger');
          return `<span class="ledger-mini-row"><i class="swatch slot-${c.slot}"></i><span class="ledger-mini-memo">${escapeHtml(e.memo || c.name)}</span><span class="${t}">${t === 'income' ? '+' : '-'}${formatWon(e.amount)}</span></span>`;
        }).join('')}
        ${entries.length > MAX ? `<span class="muted small">외 ${entries.length - MAX}건</span>` : ''}
      </span>
    </button>`;
}

function renderEvents(events) {
  const list = events.length
    ? `<ul class="event-list">${events.map(e => {
        const total = daysBetween(e.start, e.end) + 1;
        const nth = daysBetween(e.start, key) + 1;
        const when = `${formatTime(e.time)}${e.endTime && e.endTime !== e.time && total === 1 ? ` ~ ${formatTime(e.endTime)}` : ''}${total > 1 ? ` · ${nth}일차 / ${total}일` : ''}`;
        if (e.source === 'google') {
          return `
          <li class="event g-event" title="구글 캘린더 · ${escapeHtml(e.calName)}">
            <i class="event-dot" style="background:${safeColor(e.color)}"></i>
            <div class="event-main">
              <div class="event-title">${escapeHtml(e.title)}</div>
              <div class="muted small">${when}${e.recurring ? ' · 반복' : ''} · ${escapeHtml(e.calName)}</div>
            </div>
            ${e.link ? `<a class="g-open" href="${escapeHtml(e.link)}" target="_blank" rel="noopener noreferrer" aria-label="구글 캘린더에서 열기" title="구글 캘린더에서 열기">G</a>` : '<span class="g-open" aria-hidden="true">G</span>'}
          </li>`;
        }
        return `
          <li class="event" data-id="${escapeHtml(e.id)}">
            <i class="event-dot" style="background:${safeColor(e.color)}"></i>
            <div class="event-main">
              <div class="event-title">${escapeHtml(e.title)}</div>
              <div class="muted small">${when}</div>
            </div>
            <button type="button" class="del-btn" data-act="delete-event" aria-label="삭제">✕</button>
          </li>`;
      }).join('')}</ul>`
    : '<p class="empty">일정이 없어요.</p>';

  eventsSlot.innerHTML = `
    ${list}
    <details class="event-add">
      <summary>＋ 일정 추가</summary>
      <form class="event-form">
        <input name="title" type="text" maxlength="80" placeholder="무슨 일이 있나요?" required />
        <div class="form-row">
          <label>시작 <input name="start" type="date" value="${key}" required /></label>
          <label>종료 <input name="end" type="date" value="${key}" required /></label>
        </div>
        <div class="form-row">
          <label>시간 <input name="time" type="time" /></label>
          <span class="muted small">비우면 종일</span>
        </div>
        <div class="color-row" role="radiogroup" aria-label="색상">
          ${EVENT_COLORS.map((c, i) => `
            <label class="color-swatch" style="--sw:${c.hex}" title="${c.label}">
              <input type="radio" name="color" value="${c.hex}"${i === 0 ? ' checked' : ''} aria-label="${c.label}" />
            </label>`).join('')}
        </div>
        <button class="primary-btn wide">담아두기</button>
      </form>
    </details>`;
}

// ---- 이벤트 연결 ----
bindDateNav(navSlot, () => key, k => openDayPanel(k));
bindCategoryLongPress(summarySlot);

el.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) return closeOverlay(el);
  const go = e.target.closest('[data-goto]');
  if (go) return window.dispatchEvent(new CustomEvent('ple:goto', { detail: { tab: go.dataset.goto, key } }));
  if (e.target.closest('[data-act="delete-event"]')) {
    removeWithUndo('events', e.target.closest('.event').dataset.id, '일정을 삭제했어요');
  }
});

eventsSlot.addEventListener('submit', e => {
  if (!e.target.matches('.event-form')) return;
  e.preventDefault();
  const f = new FormData(e.target);
  const title = String(f.get('title') || '').trim();
  let start = String(f.get('start'));
  let end = String(f.get('end'));
  if (!title || !isValidKey(start)) return;
  if (!isValidKey(end) || end < start) end = start;
  store.put('events', { title, start, end, time: String(f.get('time') || ''), color: safeColor(f.get('color')) });
});

// ---- 모바일: 손잡이를 아래로 끌어 닫기 ----
let dragStartY = null;
let dragDy = 0;
el.querySelector('.sheet-handle').addEventListener('touchstart', e => {
  dragStartY = e.touches[0].clientY;
  dragDy = 0;
  el.classList.add('dragging');
}, { passive: true });
window.addEventListener('touchmove', e => {
  if (dragStartY === null) return;
  dragDy = Math.max(0, e.touches[0].clientY - dragStartY);
  el.style.transform = `translateY(${dragDy}px)`;
}, { passive: true });
window.addEventListener('touchend', () => {
  if (dragStartY === null) return;
  dragStartY = null;
  el.classList.remove('dragging');
  el.style.transform = '';
  if (dragDy > 100) closeOverlay(el);
});

window.addEventListener('ple:moneychange', () => render());
