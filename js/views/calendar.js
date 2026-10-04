// 📅 캘린더 탭: 월간 달력 + [?월 ▾] 선택기. 날짜 칸을 누르면 하루 통합 패널이 열린다.
import { store } from '../store.js';
import { closeOverlay, toggleOverlay, closeOnBackdrop } from '../ui/overlay.js';
import { openDayPanel, currentPanelKey } from './dayPanel.js';
import { toKey, todayKey, DOW_NAMES, formatNumber, sumAmounts, safeColor } from '../utils.js';
import { onlyExpenses } from '../ledgerMath.js';
import { tasksOn } from '../taskRepeat.js';
import { getSetting, setSetting } from '../settings.js';
import { toast } from '../ui/toast.js';
import * as gcal from '../sync/gcal.js';

const el = document.getElementById('view-calendar');
const picker = document.getElementById('monthPicker');

const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth();
let pickerYear = viewYear;

export function moveMonth(delta) {
  const d = new Date(viewYear, viewMonth + delta, 1);
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
  render();
}

export function goToday() {
  const t = new Date();
  viewYear = t.getFullYear();
  viewMonth = t.getMonth();
  render();
}

export function render() {
  const today = todayKey();
  const selected = currentPanelKey();
  const t = new Date();
  const isCurrentMonth = viewYear === t.getFullYear() && viewMonth === t.getMonth();
  const startOffset = new Date(viewYear, viewMonth, 1).getDay();

  const showMoney = getSetting('money');
  gcal.setViewMonth(viewYear, viewMonth);
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const date = new Date(viewYear, viewMonth, 1 - startOffset + i);
    const key = toKey(date.getFullYear(), date.getMonth(), date.getDate());
    const events = [...store.eventsOn(key), ...gcal.eventsOn(key)];
    const tasks = tasksOn(key);
    const spent = showMoney ? sumAmounts(onlyExpenses(store.byDate('expenses', key))) : 0;
    const cls = [
      'cell', `dow-${date.getDay()}`,
      date.getMonth() !== viewMonth && 'outside',
      key === today && 'today',
      key === selected && 'selected',
    ].filter(Boolean).join(' ');

    cells += `
      <button type="button" class="${cls}" data-key="${key}" aria-label="${date.getMonth() + 1}월 ${date.getDate()}일">
        <span class="cell-num">${date.getDate()}</span>
        ${events.length ? `<span class="cell-dots">${events.slice(0, 3).map(e => `<i style="background:${safeColor(e.color)}"></i>`).join('')}</span>` : ''}
        ${spent ? `<span class="cell-spent">-${formatNumber(spent)}</span>` : ''}
        ${tasks.length ? `<span class="cell-task">✓ ${tasks.filter(x => x.done).length}/${tasks.length}</span>` : ''}
      </button>`;
  }

  el.innerHTML = `
    <div class="cal-head">
      <div>
        <div class="cal-year">${viewYear}년</div>
        <div class="cal-nav">
          <button type="button" class="icon-btn" data-act="prev" aria-label="이전 달">‹</button>
          <button type="button" class="month-btn" data-act="pick" aria-haspopup="dialog">${viewMonth + 1}월 <span class="caret">▾</span></button>
          <button type="button" class="icon-btn" data-act="next" aria-label="다음 달">›</button>
        </div>
      </div>
      <div class="cal-tools">
        ${isCurrentMonth ? '' : '<button type="button" class="pill-btn" data-act="today">오늘</button>'}
        <button type="button" class="money-toggle${showMoney ? ' on' : ''}" data-act="money" role="switch" aria-checked="${showMoney}" aria-label="캘린더에 가계부 금액 보기" title="가계부 금액 보기 켜기/끄기">
          <span class="money-icon" aria-hidden="true">💰</span><span class="switch${showMoney ? ' on' : ''}" aria-hidden="true"></span>
        </button>
      </div>
    </div>
    <div class="dow-row">${DOW_NAMES.map((n, i) => `<span class="dow-${i}">${n}</span>`).join('')}</div>
    <div class="grid">${cells}</div>`;
}

el.addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'prev') return moveMonth(-1);
  if (act === 'next') return moveMonth(1);
  if (act === 'today') return goToday();
  if (act === 'money') {
    const on = !getSetting('money');
    setSetting('money', on);
    toast(on ? '💰 가계부 금액을 다시 보여줘요' : '💰 가계부 금액을 숨겼어요');
    render();
    window.dispatchEvent(new CustomEvent('ple:moneychange'));
    return;
  }
  if (act === 'pick') {
    pickerYear = viewYear;
    renderPicker();
    return toggleOverlay({ el: picker });
  }
  const cell = e.target.closest('.cell');
  if (cell) {
    const key = cell.dataset.key;
    // 다른 달의 날짜를 누르면 그 달로 넘어간다
    const [y, m] = key.split('-').map(Number);
    if (y !== viewYear || m - 1 !== viewMonth) { viewYear = y; viewMonth = m - 1; }
    openDayPanel(key);
    render();
  }
});

// ---- [?월 ▾] 선택 창 ----
function renderPicker() {
  const t = new Date();
  picker.innerHTML = `
    <div class="modal-box">
      <div class="modal-head">
        <button type="button" class="icon-btn" data-py="-1" aria-label="이전 해">‹</button>
        <strong>${pickerYear}년</strong>
        <button type="button" class="icon-btn" data-py="1" aria-label="다음 해">›</button>
        <button type="button" class="icon-btn close-btn" data-close aria-label="닫기">✕</button>
      </div>
      <div class="month-grid">
        ${Array.from({ length: 12 }, (_, i) => {
          const cls = [
            'month-cell',
            pickerYear === viewYear && i === viewMonth && 'selected',
            pickerYear === t.getFullYear() && i === t.getMonth() && 'current',
          ].filter(Boolean).join(' ');
          return `<button type="button" class="${cls}" data-month="${i}">${i + 1}월</button>`;
        }).join('')}
      </div>
      <div class="modal-foot"><button type="button" class="pill-btn" data-act="today">오늘로</button></div>
    </div>`;
}

closeOnBackdrop(picker);
picker.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) return closeOverlay(picker);
  const py = e.target.closest('[data-py]');
  if (py) { pickerYear += Number(py.dataset.py); return renderPicker(); }
  const month = e.target.closest('[data-month]');
  if (month) {
    viewYear = pickerYear;
    viewMonth = Number(month.dataset.month);
    closeOverlay(picker);
    return render();
  }
  if (e.target.closest('[data-act="today"]')) { closeOverlay(picker); goToday(); }
});

