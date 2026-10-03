// 고정 수입·지출 (매월 반복). 규칙은 'recurring', 실제 기록은 'expenses'에 만든다.
// 기록 id는 '규칙 + 연월'로 정해져 있어 같은 달에 두 번 생기지 않는다 (나중에 기기 간 동기화해도 중복 없음).
// 사용자가 자동 기록을 지우거나 '건너뛰기' 하면 삭제 표시가 남으므로 다시 만들지 않는다.
import { store } from './store.js';
import { toKey, todayKey, pad, daysBetween } from './utils.js';
import { daysInMonth } from './ledgerMath.js';
import { rememberPreset } from './categories.js';

export const monthKeyOf = (y, m) => `${y}-${pad(m + 1)}`;
const parseMonth = mk => { const [y, m] = mk.split('-').map(Number); return { y, m: m - 1 }; };
const shiftMonth = (mk, n) => { const { y, m } = parseMonth(mk); const d = new Date(y, m + n, 1); return monthKeyOf(d.getFullYear(), d.getMonth()); };
const currentMonth = () => todayKey().slice(0, 7);

/** 그 달의 기록 날짜. 31일이 없는 달이면 말일 */
export function dueDateOf(rule, y, m) {
  const dim = daysInMonth(y, m);
  const d = rule.day === 'last' ? dim : Math.min(Number(rule.day) || 1, dim);
  return toKey(y, m, d);
}
const dueInMonth = (rule, mk) => { const { y, m } = parseMonth(mk); return dueDateOf(rule, y, m); };

export const occurrenceId = (rule, mk) => `r_${rule.id}_${mk}`;
export const dayLabel = rule => (rule.day === 'last' ? '매월 말일' : `매월 ${rule.day}일`);

export const allRules = () => store.list('recurring')
  .sort((a, b) => (a.type === b.type ? 0 : a.type === 'income' ? -1 : 1) || dayNum(a) - dayNum(b));
const dayNum = r => (r.day === 'last' ? 32 : Number(r.day));

/** 시작 달: 이번 달 날짜가 아직 안 지났으면(오늘 포함) 이번 달부터, 지났으면 다음 달부터 (includeThisMonth면 이번 달) */
export function startMonthFor(rule, includeThisMonth = false) {
  const cur = currentMonth();
  return includeThisMonth || dueInMonth(rule, cur) >= todayKey() ? cur : shiftMonth(cur, 1);
}

/** 오늘까지 기록됐어야 하는데 아직 없는 회차 */
function dueOccurrences() {
  const today = todayKey();
  const cur = currentMonth();
  const out = [];
  for (const r of store.list('recurring', x => !x.paused)) {
    const end = r.endMonth && r.endMonth < cur ? r.endMonth : cur;
    if (!r.startMonth || r.startMonth > end) continue;
    for (let mk = r.startMonth; mk <= end; mk = shiftMonth(mk, 1)) {
      const date = dueInMonth(r, mk);
      if (date > today) continue;
      const id = occurrenceId(r, mk);
      if (store.peek('expenses', id)) continue; // 이미 기록됨, 지움, 건너뜀
      out.push({ rule: r, id, date, mk });
    }
  }
  return out;
}

const entryOf = (o, amount) => ({
  id: o.id, date: o.date, type: o.rule.type, category: o.rule.category ?? null,
  amount, memo: o.rule.memo, recurringId: o.rule.id, period: o.mk,
});

/** 날짜가 된 고정 항목을 기록한다. 금액을 물어봐야 하는 항목은 제외. 반환값: 기록한 개수 */
export function runRecurring() {
  const due = dueOccurrences().filter(o => !o.rule.askAmount);
  if (due.length) store.batch(() => due.forEach(o => store.put('expenses', entryOf(o, o.rule.amount))));
  return due.length;
}

/** "전기요금 얼마였나요?" 처럼 금액 입력을 기다리는 회차 */
export const pendingAsks = () => dueOccurrences().filter(o => o.rule.askAmount);

export function recordAsk(o, amount) {
  store.put('expenses', entryOf(o, amount));
}

export function skipAsk(o) {
  store.batch(() => {
    store.put('expenses', { ...entryOf(o, 0), skipped: true });
    store.remove('expenses', o.id);
  });
}

/** 다음 기록 날짜 (일시정지·종료면 null) */
export function nextDueOf(rule) {
  if (rule.paused) return null;
  const today = todayKey();
  let mk = rule.startMonth > currentMonth() ? rule.startMonth : currentMonth();
  for (let i = 0; i < 3; i++, mk = shiftMonth(mk, 1)) {
    if (rule.endMonth && mk > rule.endMonth) return null;
    const date = dueInMonth(rule, mk);
    if (date >= today && !store.peek('expenses', occurrenceId(rule, mk))) return date;
  }
  return null;
}

/** 이번 달에 아직 안 들어온 예정 항목 (가계부 '예상 남은 돈'용) */
export function upcomingThisMonth() {
  const cur = currentMonth();
  const today = todayKey();
  return store.list('recurring', r => !r.paused)
    .filter(r => r.startMonth <= cur && (!r.endMonth || r.endMonth >= cur))
    .map(r => ({ rule: r, date: dueInMonth(r, cur) }))
    .filter(o => o.date > today && !store.peek('expenses', occurrenceId(o.rule, cur)));
}

export function saveRule(input, { includeThisMonth = false } = {}) {
  const prev = input.id ? store.get('recurring', input.id) : null;
  const rule = { ...prev, ...input };
  if (!prev) rule.startMonth = startMonthFor(rule, includeThisMonth);
  const saved = store.put('recurring', rule);
  rememberPreset(saved.category, { type: saved.type, day: saved.day, amount: saved.amount, askAmount: !!saved.askAmount });
  runRecurring();
  return saved;
}

/** 일시정지 ↔ 다시 시작. 다시 시작하면 멈춘 동안의 달은 기록하지 않는다 */
export function togglePause(id) {
  const r = store.get('recurring', id);
  if (!r) return;
  if (r.paused) store.put('recurring', { id, paused: false, startMonth: startMonthFor(r) });
  else store.put('recurring', { id, paused: true });
  runRecurring();
}

/** 이번 달 상태: 기록됨 / 건너뜀 / 금액 입력 필요 / D-n 예정 / 일시정지 / N월부터 */
export function ruleStatus(rule) {
  const cur = currentMonth();
  const today = todayKey();
  if (rule.paused) return { key: 'paused', label: '일시정지' };
  if (rule.startMonth > cur) return { key: 'later', label: `${Number(rule.startMonth.slice(5))}월부터` };
  const occ = store.peek('expenses', occurrenceId(rule, cur));
  if (occ) return occ.deleted ? { key: 'skipped', label: '건너뜀' } : { key: 'done', label: '기록됨' };
  const due = dueInMonth(rule, cur);
  if (due <= today) return rule.askAmount ? { key: 'ask', label: '금액 입력 필요' } : { key: 'done', label: '기록됨' };
  const d = daysBetween(today, due);
  return { key: 'upcoming', label: `D-${d} 예정` };
}

/** 이번 달 진행: 이번 달에 해당하는 고정 항목 중 처리된 것 */
export function monthProgress() {
  const list = store.list('recurring', r => !r.paused && r.startMonth <= currentMonth() && (!r.endMonth || r.endMonth >= currentMonth()));
  const done = list.filter(r => ['done', 'skipped'].includes(ruleStatus(r).key)).length;
  return { done, total: list.length };
}

/** 규칙 삭제. 이미 기록된 것은 그대로 남는다 */
export const deleteRule = id => store.remove('recurring', id);
