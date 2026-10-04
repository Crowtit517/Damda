// 기기 저장 레이어.
// 화면은 메모리의 data를 바로 읽고(빠름), 저장은 뒤에서 IndexedDB에 "바뀐 항목만" 쓴다.
// 데이터 모양은 하나의 JSON과 같다 (드라이브 동기화 파일과 같은 형태).
// 삭제는 실제로 지우지 않고 deleted: true 로 표시한다 (실행 취소, 동기화 시 부활 방지).
//
// 저장소: IndexedDB(서랍장) → 못 쓰면 예전처럼 localStorage(메모지) 'ple-v1'.
// 예전 'ple-v1'은 지우지 않고 백업으로 남겨 두고, 앱을 열 때마다 그쪽에 더 새로운 항목이 있으면 가져온다
// (IndexedDB를 못 쓴 날 적은 기록도 이렇게 다시 합쳐진다).
import { isValidKey } from './utils.js';
import * as idb from './db.js';

const STORAGE_KEY = 'ple-v1';
const COLLECTIONS = ['tasks', 'expenses', 'events', 'categories', 'recurring', 'taskRules', 'catFolders'];

const emptyData = () => ({ version: 1, tasks: {}, expenses: {}, events: {}, categories: {}, recurring: {}, taskRules: {}, catFolders: {} });

function loadLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && parsed.version === 1) {
      for (const c of COLLECTIONS) if (!parsed[c] || typeof parsed[c] !== 'object') parsed[c] = {};
      return parsed;
    }
  } catch {}
  return emptyData();
}

function saveLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

const newer = (a, b) => !b || (Number(a.updatedAt) || 0) > (Number(b.updatedAt) || 0);

/** source에서 더 새로운 항목을 data로 가져온다. 반환값: 바뀐 [컬렉션, 항목] 목록 */
function takeNewer(source) {
  const changed = [];
  for (const c of COLLECTIONS) {
    for (const item of Object.values(source?.[c] || {})) {
      if (!item || typeof item.id !== 'string') continue;
      if (newer(item, data[c][item.id])) { data[c][item.id] = item; changed.push([c, item]); }
    }
  }
  return changed;
}

let data = emptyData();
let backend = 'local'; // 'idb' | 'local'
const listeners = new Set();
let batching = 0;
let pending = false;
const dirty = new Map(); // 아직 IndexedDB에 쓰지 않은 항목 '컬렉션/아이디' → [컬렉션, 아이디]
let flushTimer = null;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('damda-store') : null;

async function init() {
  const local = loadLocal();
  try {
    const fromDb = await idb.readAll(COLLECTIONS);
    data = { ...emptyData(), ...fromDb, version: 1 };
    const moved = takeNewer(local);
    if (moved.length) await idb.writeItems(moved);
    if (!(await idb.getMeta('migrated'))) {
      // 처음 옮긴 날: 다시 읽어서 개수가 맞는지 확인한 뒤에만 IndexedDB를 쓴다
      const check = await idb.readAll(COLLECTIONS);
      const count = d => COLLECTIONS.reduce((n, c) => n + Object.keys(d[c] || {}).length, 0);
      if (count(check) < count(local)) throw new Error('옮긴 기록 수가 맞지 않아요');
      await idb.setMeta('migrated', { from: STORAGE_KEY, at: Date.now(), count: count(check) });
    }
    backend = 'idb';
    // 설치한 앱이면 "이 저장소는 지우지 말아 주세요"를 요청 (브라우저가 공간이 부족해도 지우지 않게)
    try { if (matchMedia('(display-mode: standalone)').matches) navigator.storage?.persist?.(); } catch {}
  } catch (err) {
    console.warn('IndexedDB 대신 localStorage에 저장해요:', err?.message || err);
    data = local;
    backend = 'local';
  }
}
await init();

function emit() {
  listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
}

function markDirty(collection, id) {
  dirty.set(`${collection}/${id}`, [collection, id]);
}

async function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!dirty.size) return;
  const list = [...dirty.values()].map(([c, id]) => [c, data[c][id]]).filter(([, item]) => item);
  dirty.clear();
  try {
    await idb.writeItems(list);
    channel?.postMessage('changed');
  } catch (err) {
    // IndexedDB에 못 쓰면 메모지에라도 남긴다. 다음에 열 때 다시 합쳐진다
    console.warn('IndexedDB 저장 실패, localStorage에 남겨요:', err?.message || err);
    backend = 'local';
    saveLocal();
  }
}

function persist() {
  if (backend === 'idb') { if (!flushTimer) flushTimer = setTimeout(flush, 0); }
  else saveLocal();
  if (batching) pending = true;
  else emit();
}

// 화면을 떠날 때 남은 저장을 바로 끝낸다
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', () => flush());

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
    markDirty(collection, saved.id);
    persist();
    return saved;
  },

  remove(collection, id) {
    const item = data[collection][id];
    if (!item) return;
    data[collection][id] = { ...item, deleted: true, updatedAt: Date.now() };
    markDirty(collection, id);
    persist();
  },

  restore(collection, id) {
    const item = data[collection][id];
    if (!item) return;
    data[collection][id] = { ...item, deleted: false, updatedAt: Date.now() };
    markDirty(collection, id);
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
            markDirty(c, item.id);
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

/** 지금 어디에 저장하고 있는지 (점검용) */
export const storageBackend = () => backend;

// 다른 탭에서 바뀐 경우에도 화면 갱신
channel?.addEventListener('message', async () => {
  if (backend !== 'idb') return;
  try {
    if (takeNewer(await idb.readAll(COLLECTIONS)).length) emit();
  } catch {}
});
window.addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY || backend !== 'local') return;
  takeNewer(loadLocal());
  emit();
});
