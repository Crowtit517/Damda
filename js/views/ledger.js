// 💰 가계부 탭: 큰 숫자 + 같은 기간 비교 + 그래프 + 수입·지출 + 카테고리별 + 날짜별 기록.
import { dateNavHtml, bindDateNav } from '../parts/dateNav.js';
import { renderEntries } from '../parts/entryList.js';
import { lineChart, barChart } from '../parts/charts.js';
import { bindCategoryLongPress } from '../parts/categoryUI.js';
import { monthStats, yearStats } from '../ledgerMath.js';
import { recurringCardHtml, pendingAsksHtml, bindRecurring } from '../parts/recurringUI.js';
import { upcomingThisMonth } from '../recurring.js';
import { todayKey, toKey, keyToDate, formatWon, escapeHtml, loadPref, savePref } from '../utils.js';

const el = document.getElementById('view-ledger');
el.innerHTML = `
  <div class="ledger-top">
    <div class="seg" role="tablist" aria-label="보기">
      <button type="button" role="tab" data-mode="month">월</button>
      <button type="button" role="tab" data-mode="year">년</button>
    </div>
    <div class="period-nav">
      <button type="button" class="icon-btn" data-period="-1" aria-label="이전">‹</button>
      <strong class="period-label"></strong>
      <button type="button" class="icon-btn" data-period="1" aria-label="다음">›</button>
    </div>
  </div>
  <div class="ask-slot"></div>
  <div class="stats-slot"></div>
  <div class="recurring-slot"></div>
  <h3 class="block-title">날짜별 기록</h3>
  <div class="nav-slot"></div>
  <div id="tabEntries"></div>`;

const statsSlot = el.querySelector('.stats-slot');
const navSlot = el.querySelector('.nav-slot');
const body = el.querySelector('#tabEntries');
const askSlot = el.querySelector('.ask-slot');
const recurringSlot = el.querySelector('.recurring-slot');
bindRecurring(askSlot);
bindRecurring(recurringSlot);
bindCategoryLongPress(statsSlot);

let mode = loadPref('ple-ledger-mode', 'month');
const t0 = keyToDate(todayKey());
let viewY = t0.getFullYear();
let viewM = t0.getMonth();
let dayKey = todayKey();

function compareHtml(thisV, lastV, label, cannot) {
  if (cannot) return '<div class="compare same">아직 오지 않은 기간이에요</div>';
  if (!lastV) return `<div class="compare same">${label} 기록이 없어 비교할 수 없어요</div>`;
  const diff = thisV - lastV;
  const pct = Math.abs((diff / lastV) * 100).toFixed(1);
  if (diff === 0) return `<div class="compare same">${label}과 똑같이 썼어요</div>`;
  const up = diff > 0;
  return `<div class="compare ${up ? 'up' : 'down'}">
    <span class="arrow" aria-hidden="true">${up ? '▲' : '▼'}</span>
    ${label}보다 <strong>${formatWon(Math.abs(diff))}</strong> ${up ? '더' : '덜'} 썼어요 <span class="pct">(${pct}%)</span>
  </div>`;
}

function flowHtml(income, expense, upcoming = []) {
  const net = income - expense;
  const known = upcoming.filter(o => !o.rule.askAmount);
  const upIn = known.filter(o => o.rule.type === 'income').reduce((s, o) => s + o.rule.amount, 0);
  const upOut = known.filter(o => o.rule.type === 'expense').reduce((s, o) => s + o.rule.amount, 0);
  const unknown = upcoming.length - known.length;
  const expected = net + upIn - upOut;
  return `
    <div class="flow-row">
      <div><span class="muted">수입</span><strong class="income">${income ? '+' : ''}${formatWon(income)}</strong></div>
      <div><span class="muted">지출</span><strong class="expense">${expense ? '-' : ''}${formatWon(expense)}</strong></div>
      <div><span class="muted">남은 돈</span><strong>${net < 0 ? '-' : ''}${formatWon(Math.abs(net))}</strong></div>
    </div>
    ${upcoming.length ? `
      <div class="expect-row">
        이번 달 남은 고정 항목${upIn ? ` · 수입 <strong>+${formatWon(upIn)}</strong>` : ''}${upOut ? ` · 지출 <strong>-${formatWon(upOut)}</strong>` : ''}${unknown ? ` · 금액 미정 ${unknown}건` : ''}
        <span class="expect-net">→ 월말 예상 남은 돈 <strong>${expected < 0 ? '-' : ''}${formatWon(Math.abs(expected))}</strong></span>
      </div>` : ''}`;
}

function categoriesHtml(rows, title) {
  if (!rows.length) return `<div class="breakdown"><div class="block-title">${title}</div><p class="empty">지출 기록이 없어요.</p></div>`;
  const max = rows[0].amount || 1;
  return `
    <div class="breakdown">
      <div class="block-title">${title}</div>
      <ul>${rows.map(r => `
        <li class="breakdown-row"${r.cat.id ? ` data-cat-id="${escapeHtml(r.cat.id)}" data-cat-kind="ledger"` : ''}>
          <span class="breakdown-name"><i class="swatch slot-${r.cat.slot}"></i>${escapeHtml(r.cat.name)}</span>
          <span class="breakdown-bar"><i class="slot-${r.cat.slot}" style="width:${(r.amount / max) * 100}%"></i></span>
          <span class="breakdown-amount">${formatWon(r.amount)}</span>
          <span class="breakdown-pct">${r.pct.toFixed(0)}%</span>
        </li>`).join('')}</ul>
    </div>`;
}

function renderMonth() {
  const s = monthStats(viewY, viewM);
  statsSlot.innerHTML = `
    <div class="hero">
      <div class="muted">${viewM + 1}월 지출${s.isCurrent ? ' (오늘까지)' : ''}</div>
      <div class="hero-num">${formatWon(s.expense)}</div>
      ${compareHtml(s.thisUpTo, s.lastUpTo, s.isCurrent ? '지난달 같은 기간' : '지난달', s.isFuture)}
    </div>
    <div class="chart-card">
      <div class="legend">
        <span><i class="key main"></i>${viewM + 1}월 누적</span>
        <span><i class="key compare"></i>${s.pm + 1}월 누적</span>
      </div>
      <div class="chart" data-chart></div>
    </div>
    ${flowHtml(s.income, s.expense, s.isCurrent ? upcomingThisMonth() : [])}
    ${categoriesHtml(s.categories, `${viewM + 1}월 카테고리별 지출`)}`;

  const days = Math.max(s.days, s.pDays);
  const wrap = statsSlot.querySelector('[data-chart]');
  const draw = () => lineChart(wrap, {
    series: [
      { label: `${viewM + 1}월`, values: s.cumThis },
      { label: `${s.pm + 1}월`, values: s.cumLast },
    ],
    days,
    dayLabel: i => `${i + 1}일까지`,
    xTicks: [0, 14, days - 1],
    ariaLabel: `${viewM + 1}월 누적 지출 ${formatWon(s.expense)}, ${s.pm + 1}월 같은 기간 ${formatWon(s.lastUpTo)}`,
  });
  draw();
  wrap._draw = draw;
}

function renderYear() {
  const s = yearStats(viewY);
  statsSlot.innerHTML = `
    <div class="hero">
      <div class="muted">${viewY}년 지출${s.isCurrent ? ' (오늘까지)' : ''}</div>
      <div class="hero-num">${formatWon(s.expense)}</div>
      ${compareHtml(s.thisUpTo, s.lastUpTo, s.isCurrent ? '작년 같은 기간' : '작년', s.isFuture)}
    </div>
    <div class="chart-card">
      <div class="legend">
        <span><i class="key main"></i>${viewY}년</span>
        <span><i class="key compare"></i>${viewY - 1}년</span>
        <span class="muted small legend-hint">막대를 누르면 그 달로</span>
      </div>
      <div class="chart" data-chart></div>
    </div>
    ${flowHtml(s.income, s.expense)}
    ${categoriesHtml(s.categories, `${viewY}년 카테고리별 지출`)}`;

  const wrap = statsSlot.querySelector('[data-chart]');
  const t = keyToDate(todayKey());
  const draw = () => barChart(wrap, {
    current: s.months,
    compare: s.lastMonths,
    labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
    activeIdx: viewY === t.getFullYear() ? t.getMonth() : -1,
    currentLabel: `${viewY}년`,
    compareLabel: `${viewY - 1}년`,
    ariaLabel: `${viewY}년 월별 지출, 합계 ${formatWon(s.expense)}`,
    onPick: i => { viewM = i; setMode('month'); },
  });
  draw();
  wrap._draw = draw;
}

export function render() {
  el.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  el.querySelector('.period-label').textContent = mode === 'month' ? `${viewY}년 ${viewM + 1}월` : `${viewY}년`;
  askSlot.innerHTML = pendingAsksHtml();
  if (mode === 'month') renderMonth(); else renderYear();
  recurringSlot.innerHTML = recurringCardHtml();
  navSlot.innerHTML = dateNavHtml(dayKey);
  renderEntries(body, dayKey, { showDayTotal: true });
}

function setMode(next) {
  mode = next;
  savePref('ple-ledger-mode', mode);
  syncDayToMonth();
  render();
}

// 월을 넘기면 날짜별 기록도 그 달로 (이번 달이면 오늘, 아니면 1일)
function syncDayToMonth() {
  if (mode !== 'month') return;
  const d = keyToDate(dayKey);
  if (d.getFullYear() === viewY && d.getMonth() === viewM) return;
  const t = keyToDate(todayKey());
  dayKey = t.getFullYear() === viewY && t.getMonth() === viewM ? todayKey() : toKey(viewY, viewM, 1);
}

el.addEventListener('click', e => {
  const m = e.target.closest('[data-mode]');
  if (m) return setMode(m.dataset.mode);
  const p = e.target.closest('[data-period]');
  if (p) {
    const n = Number(p.dataset.period);
    if (mode === 'month') {
      const d = new Date(viewY, viewM + n, 1);
      viewY = d.getFullYear(); viewM = d.getMonth();
    } else viewY += n;
    syncDayToMonth();
    return render();
  }
});

// 날짜별 기록의 날짜를 바꾸면 위 통계도 그 달로 따라간다
const setDay = k => {
  dayKey = k;
  const d = keyToDate(k);
  viewY = d.getFullYear();
  viewM = d.getMonth();
  render();
};
bindDateNav(navSlot, () => dayKey, setDay);

/** 캘린더 패널에서 넘어올 때: 그 날짜와 그 달로 (그리기는 탭 전환 때) */
export const setDate = k => {
  dayKey = k;
  const d = keyToDate(k);
  viewY = d.getFullYear();
  viewM = d.getMonth();
};

export const shiftDay = n => {
  const d = keyToDate(dayKey);
  d.setDate(d.getDate() + n);
  setDay(toKey(d.getFullYear(), d.getMonth(), d.getDate()));
};

// 화면 폭이 바뀌면 그래프만 다시 그린다
let lastWidth = 0;
new ResizeObserver(entries => {
  const w = Math.round(entries[0].contentRect.width);
  if (!w || w === lastWidth) return;
  lastWidth = w;
  statsSlot.querySelector('[data-chart]')?._draw?.();
}).observe(statsSlot);
