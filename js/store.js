// 기기 저장 레이어.
// 전체 데이터를 하나의 JSON으로 보관한다 (드라이브 동기화 파일, 내보내기 파일과 같은 형태).
// 삭제는 실제로 지우지 않고 deleted: true 로 표시한다 (실행 취소, 동기화 시 부활 방지).
import { isValidKey } from './utils.js';

const STORAGE_KEY = 'ple-v1';
const COLLECTIONS = ['tasks', 'expenses', 'events', 'categories', 'recurring', 'taskRules', 'catFolders'];

const emptyData = () => ({ version: 1, tasks: {}, expenses: {}, events: {}, categories: {}, recurring: {}, taskRules: {}, catFolders: {} });

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && parsed.version === 1) {
      for (const c of COLLECTIONS) if (!parsed[c] || typeof parsed[c] !== 'object') parsed[c] = {};
      return parsed;
    }
  } catch {}
  return emptyData();
}

let data = load();
const listeners = new Set();
let batching = 0;
let pending = false;

function emit() {
  listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
  if (batching) pending = true;
  else emit();
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// 가져오기·동기화로 들어온 항목의 최소 검증
function isValidItem(collection, item) {
  if (!item || typeof item.id !== 'string') return false;
  if (collection === 'categories') return ['task', 'ledger', 'expense', 'income'].includes(item.kind) && typeof item.name === 'string';
  if (collection === 'recurring') return ['expense', 'income'].includes(item.type) && (item.day === 'last' || (Number(item.day) >= 1 && Number(item.day) <= 31));
  if (collection === 'catFolders') return ['task', 'ledger'].includes(item.kind) && typeof item.name === 'string';
  if (collection === 'taskRules') return typeof item.title === 'string' && isValidKey(item.startDate);
  if (collection === 'events') return typeof item.title === 'string' && isValidKey(item.start) && isValidKey(item.end);
  if (collection === 'tasks' && typeof item.title !== 'string') return false;
  return isValidKey(item.date);
}

export const store = {
  get(collection, id) {
    const item = data[collection][id];
    return item && !item.deleted ? item : null;
  },

  /** 삭제 표시된 것까지 포함해 한 항목 (반복 기록 중복 방지용) */
  peek(collection, id) {
    return data[collection][id] || null;
  },

  /** 삭제 표시된 것까지 포함한 전체 (기본값 채우기 판단용) */
  all(collection) {
    return Object.values(data[collection]);
  },

  /** 삭제되지 않은 항목 목록 */
  list(collection, filter = () => true) {
    return Object.values(data[collection]).filter(item => !item.deleted && filter(item));
  },

  /** date 필드가 key인 항목 (tasks, expenses) */
  byDate(collection, key) {
    return this.list(collection, item => item.date === key);
  },

  /** key 날짜에 걸쳐 있는 일정 (start~end 포함) */
  eventsOn(key) {
    return this.list('events', e => e.start <= key && e.end >= key);
  },

  /** 추가 또는 수정 (기존 항목이면 필드를 합친다). 반환값: 저장된 항목 */
  put(collection, item) {
    const now = Date.now();
    const prev = item.id ? data[collection][item.id] : null;
    const saved = {
      ...prev,
      ...item,
      id: item.id || newId(),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      deleted: false,
    };
    data[collection][saved.id] = saved;
    persist();
    return saved;
  },

  remove(collection, id) {
    const item = data[collection][id];
    if (!item) return;
    data[collection][id] = { ...item, deleted: true, updatedAt: Date.now() };
    persist();
  },

  restore(collection, id) {
    const item = data[collection][id];
    if (!item) return;
    data[collection][id] = { ...item, deleted: false, updatedAt: Date.now() };
    persist();
  },

  /** 여러 번 저장해도 화면 갱신은 한 번만 */
  batch(fn) {
    batching++;
    try { fn(); } finally {
      batching--;
      if (!batching && pending) { pending = false; emit(); }
    }
  },

  exportData() {
    return JSON.parse(JSON.stringify(data));
  },

  /** 합치기: 항목별로 updatedAt이 더 최근인 쪽을 남긴다 (동기화와 같은 규칙). 반환값: 바뀐 항목 수 */
  importData(incoming) {
    if (!incoming || incoming.version !== 1) throw new Error('ple 백업 파일이 아니에요.');
    let changed = 0;
    this.batch(() => {
      for (const c of COLLECTIONS) {
        for (const item of Object.values(incoming[c] || {})) {
          if (!isValidItem(c, item)) continue;
          const cur = data[c][item.id];
          if (!cur || (Number(item.updatedAt) || 0) > (Number(cur.updatedAt) || 0)) {
            data[c][item.id] = item;
            changed++;
          }
        }
      }
      persist();
    });
    return changed;
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// 다른 탭에서 바뀐 경우에도 화면 갱신
window.addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY) return;
  data = load();
  emit();
});
