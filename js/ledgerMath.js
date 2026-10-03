// 가계부 계산: 기간 합계, 같은 기간 비교, 누적 곡선, 카테고리별 합계.
import { store } from './store.js';
import { toKey, todayKey, sumAmounts, keyToDate } from './utils.js';
import { categoryById } from './categories.js';

export const entryType = e => (e.type === 'income' ? 'income' : 'expense');
export const onlyExpenses = list => list.filter(e => entryType(e) === 'expense');
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

const between = (a, b, type) => store.list('expenses', e => e.date >= a && e.date <= b && (!type || entryType(e) === type));
const monthStart = (y, m) => toKey(y, m, 1);
const monthEnd = (y, m) => toKey(y, m, daysInMonth(y, m));

function byCategory(list) {
  const map = new Map();
  for (const e of list) {
    const cat = categoryById(e.category, 'ledger');
    const k = cat.id ?? 'none';
    if (!map.has(k)) map.set(k, { cat, amount: 0 });
    map.get(k).amount += Number(e.amount || 0);
  }
  const total = sumAmounts(list);
  return [...map.values()]
    .map(r => ({ ...r, pct: total ? (r.amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

/** 월 통계. 비교는 '같은 날짜까지' (이번 달이면 오늘까지, 지난 달이면 한 달 전체) */
export function monthStats(y, m) {
  const today = keyToDate(todayKey());
  const days = daysInMonth(y, m);
  const ym = y * 12 + m;
  const nowYm = today.getFullYear() * 12 + today.getMonth();
  const isCurrent = ym === nowYm;
  const isFuture = ym > nowYm;
  const cutoff = isCurrent ? today.getDate() : isFuture ? 0 : days;

  const prev = new Date(y, m - 1, 1);
  const py = prev.getFullYear();
  const pm = prev.getMonth();
  const pDays = daysInMonth(py, pm);

  const expenses = between(monthStart(y, m), monthEnd(y, m), 'expense');
  const income = between(monthStart(y, m), monthEnd(y, m), 'income');
  const lastExpenses = between(monthStart(py, pm), monthEnd(py, pm), 'expense');

  const daily = (list, n, yy, mm) => {
    const arr = Array(n).fill(0);
    for (const e of list) {
      const d = keyToDate(e.date);
      if (d.getFullYear() === yy && d.getMonth() === mm) arr[d.getDate() - 1] += Number(e.amount || 0);
    }
    let run = 0;
    return arr.map(v => (run += v));
  };
  const cumThis = daily(expenses, days, y, m).slice(0, cutoff);
  const cumLast = daily(lastExpenses, pDays, py, pm);

  const thisUpTo = cutoff ? cumThis[cutoff - 1] : 0;
  const lastUpTo = isCurrent ? cumLast[Math.min(cutoff, pDays) - 1] || 0 : cumLast[pDays - 1] || 0;

  return {
    y, m, days, cutoff, isCurrent, isFuture, py, pm, pDays,
    expense: sumAmounts(expenses),
    income: sumAmounts(income),
    thisUpTo, lastUpTo, cumThis, cumLast,
    categories: byCategory(expenses),
  };
}

/** 연 통계. 비교는 작년 같은 기간 (올해면 오늘 날짜까지) */
export function yearStats(y) {
  const today = todayKey();
  const ty = keyToDate(today).getFullYear();
  const cutoffMd = y === ty ? today.slice(4) : '-12-31';
  const isFuture = y > ty;

  const monthly = yy => Array.from({ length: 12 }, (_, m) => sumAmounts(between(monthStart(yy, m), monthEnd(yy, m), 'expense')));
  const expenses = between(`${y}-01-01`, `${y}-12-31`, 'expense');

  return {
    y, isCurrent: y === ty, isFuture,
    expense: sumAmounts(expenses),
    income: sumAmounts(between(`${y}-01-01`, `${y}-12-31`, 'income')),
    months: monthly(y),
    lastMonths: monthly(y - 1),
    thisUpTo: isFuture ? 0 : sumAmounts(between(`${y}-01-01`, `${y}${cutoffMd}`, 'expense')),
    lastUpTo: isFuture ? 0 : sumAmounts(between(`${y - 1}-01-01`, `${y - 1}${cutoffMd}`, 'expense')),
    categories: byCategory(expenses),
  };
}
