// 반복 할 일 (예: 매일 약 먹기 — 아침·저녁).
// 규칙은 'taskRules'에 두고, 날마다의 할 일은 미리 만들지 않는다. 그날을 열면 규칙에서 계산해 보여주고,
// 체크하는 순간 'tasks'에 고유 id(규칙 + 날짜 + 회차)로 저장한다 → 데이터가 쌓이지 않고, 동기화해도 중복 없음.
// "이 날만 삭제"는 그 id에 삭제 표시를 남겨 다시 나타나지 않게 한다.
import { store } from './store.js';
import { keyToDate, addDays, todayKey, DOW_NAMES } from './utils.js';
import { daysInMonth } from './ledgerMath.js';

export const REPEAT_TYPES = [
  { key: 'daily', label: '매일' },
  { key: 'weekly', label: '요일 선택' },
  { key: 'monthly', label: '매월' },
];
export const DEFAULT_TIMES = { 1: [''], 2: ['아침', '저녁'], 3: ['아침', '점심', '저녁'] };

export const occurrenceTaskId = (rule, key, slot) => `tr_${rule.id}_${key}_${slot}`;

/** 규칙이 그날 해당하는지 */
export function occursOn(rule, key) {
  if (key < rule.startDate || (rule.endDate && key > rule.endDate)) return false;
  const d = keyToDate(key);
  const r = rule.repeat || { type: 'daily' };
  switch (r.type) {
    case 'weekdays': return d.getDay() >= 1 && d.getDay() <= 5;
    case 'weekly': return (r.days || []).includes(d.getDay());
    case 'monthly': {
      const dim = daysInMonth(d.getFullYear(), d.getMonth());
      const want = r.day === 'last' ? dim : Math.min(Number(r.day) || 1, dim);
      return d.getDate() === want;
    }
    default: return true;
  }
}

export function repeatLabel(rule) {
  const r = rule.repeat || { type: 'daily' };
  if (r.type === 'weekdays') return '평일';
  if (r.type === 'weekly') return (r.days || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(i => DOW_NAMES[i]).join('·') || '요일 미정';
  if (r.type === 'monthly') return r.day === 'last' ? '매월 말일' : `매월 ${r.day}일`;
  return '매일';
}

const times = rule => (rule.times?.length ? rule.times : ['']);

/** 그날의 할 일 전체: 일반 할 일 + 반복 규칙에서 나온 할 일 (아직 저장 안 된 것은 virtual) */
export function tasksOn(key) {
  const real = store.byDate('tasks', key).filter(t => !t.ruleId);
  const fromRules = [];
  for (const rule of store.list('taskRules')) {
    if (!occursOn(rule, key)) continue;
    times(rule).forEach((label, slot) => {
      const id = occurrenceTaskId(rule, key, slot);
      const saved = store.peek('tasks', id);
      if (saved?.deleted) return; // 이 날만 삭제됨
      fromRules.push({
        id, date: key, ruleId: rule.id, slot, label,
        title: rule.title, category: rule.category ?? null,
        done: !!saved?.done,
        createdAt: (rule.createdAt || 0) + slot,
        virtual: !saved,
      });
    });
  }
  return [...fromRules, ...real];
}

/** 체크 / 해제 (반복 할 일이면 그 날 기록을 만든다) */
export function setTaskDone(task, done) {
  if (task.ruleId) {
    store.put('tasks', {
      id: task.id, date: task.date, ruleId: task.ruleId, slot: task.slot,
      title: task.title, category: task.category, done,
    });
  } else {
    store.put('tasks', { id: task.id, done });
  }
}

/** 이 날만 지우기 */
export function deleteOccurrence(task) {
  store.batch(() => {
    store.put('tasks', { id: task.id, date: task.date, ruleId: task.ruleId, slot: task.slot, title: task.title, category: task.category, done: false });
    store.remove('tasks', task.id);
  });
}

/** 이 날부터 앞으로 전부 그만 (그 전 기록은 남는다) */
export function endRuleFrom(ruleId, key) {
  const rule = store.get('taskRules', ruleId);
  if (!rule) return;
  if (key <= rule.startDate) store.remove('taskRules', ruleId);
  else store.put('taskRules', { id: ruleId, endDate: addDays(key, -1) });
}

export function saveTaskRule(input) {
  const clean = {
    ...input,
    title: String(input.title || '').trim().slice(0, 100),
    times: (input.times || ['']).map(t => String(t || '').trim().slice(0, 8)),
  };
  if (!clean.title) throw new Error('할 일 이름을 입력해주세요.');
  if (clean.repeat?.type === 'weekly' && !clean.repeat.days?.length) throw new Error('반복할 요일을 하나 이상 골라주세요.');
  if (clean.endDate && clean.endDate < clean.startDate) throw new Error('끝나는 날이 시작하는 날보다 빨라요.');
  return store.put('taskRules', clean);
}

/** 연속 기록: 해당하는 날마다 모든 회차를 체크한 날이 며칠 이어졌는지. 오늘을 아직 안 했으면 어제까지로 센다 */
export function streakOf(rule, today = todayKey()) {
  const saved = (key, slot) => store.peek('tasks', occurrenceTaskId(rule, key, slot));
  const skipped = key => times(rule).some((_, slot) => saved(key, slot)?.deleted); // '이 날만 삭제'한 날은 건너뜀
  const doneOn = key => times(rule).every((_, slot) => saved(key, slot)?.done);
  let key = today;
  let count = 0;
  if (occursOn(rule, key) && !doneOn(key)) key = addDays(key, -1);
  for (let i = 0; i < 400 && key >= rule.startDate; i++, key = addDays(key, -1)) {
    if (!occursOn(rule, key) || skipped(key)) continue;
    if (!doneOn(key)) break;
    count++;
  }
  return count;
}

