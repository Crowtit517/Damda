// 카테고리 v2: 할 일(task) · 가계부(ledger) 두 목록. 가계부는 지출·수입을 나누지 않는다.
// - 처음엔 비어 있다. 사용자가 미리 적어둔 순서대로 입력 칩에 나온다.
// - 색은 사용자가 고른다: slot 0 = 색 없음, 1~8 = 검증된 팔레트 (css --cat-N).
// - 가계부 카테고리는 '자주 쓰는 고정 항목'도 겸한다: 고정 항목을 저장하면 그 설정(preset)을 기억한다.
import { store } from './store.js';
import { loadPref, savePref } from './utils.js';

export const MAX_PER_KIND = 30;
export const MAX_NAME = 10;
export const KIND_LABEL = { task: '할 일', ledger: '가계부' };
export const UNCATEGORIZED = { id: null, name: '미분류', slot: 0 };

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt;
export const newCategoryId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---- 폴더 (한 단계). 카테고리는 folderId로 폴더에 들어간다. 폴더 없는 카테고리는 맨 아래 ----
export const foldersOf = kind => store.list('catFolders', f => f.kind === kind).sort(byOrder);

/** 카테고리가 실제로 들어 있는 폴더 id (폴더가 지워졌으면 null) */
export function folderOfCategory(c) {
  const f = c.folderId ? store.get('catFolders', c.folderId) : null;
  return f && f.kind === c.kind ? f.id : null;
}

/** 폴더 순서 → 폴더 안 순서, 폴더 없는 것은 맨 뒤. 입력 칩·카드·통계가 모두 이 순서를 따른다 */
export function categoriesOf(kind) {
  const folderRank = new Map(foldersOf(kind).map((f, i) => [f.id, i]));
  const rank = c => { const f = folderOfCategory(c); return f ? folderRank.get(f) : Infinity; };
  return store.list('categories', c => c.kind === kind).sort((a, b) => (rank(a) - rank(b)) || byOrder(a, b));
}

export function addFolder(kind, name) {
  const clean = String(name || '').trim().slice(0, MAX_NAME);
  if (!clean) throw new Error('폴더 이름을 입력해주세요.');
  if (foldersOf(kind).some(f => f.name === clean)) throw new Error('같은 이름의 폴더가 이미 있어요.');
  const list = foldersOf(kind);
  return store.put('catFolders', { kind, name: clean, order: list.length ? Math.max(...list.map(f => f.order ?? 0)) + 1 : 0, collapsed: false });
}

export function updateFolder(id, patch) {
  const f = store.get('catFolders', id);
  if (!f) return null;
  const next = { id, ...patch };
  if ('name' in patch) {
    next.name = String(patch.name || '').trim().slice(0, MAX_NAME);
    if (!next.name) throw new Error('폴더 이름을 입력해주세요.');
    if (foldersOf(f.kind).some(x => x.name === next.name && x.id !== id)) throw new Error('같은 이름의 폴더가 이미 있어요.');
  }
  return store.put('catFolders', next);
}

/** 폴더 삭제: 안의 카테고리는 폴더 밖으로 (지워지지 않음). 반환값: 되돌리기용 기록 */
export function deleteFolder(id) {
  const f = store.get('catFolders', id);
  if (!f) return null;
  const moved = store.list('categories', c => c.folderId === id).map(c => c.id);
  store.batch(() => {
    moved.forEach(cid => store.put('categories', { id: cid, folderId: null }));
    store.remove('catFolders', id);
  });
  return { id, moved };
}

export function restoreFolder(snapshot) {
  if (!snapshot) return;
  store.batch(() => {
    store.restore('catFolders', snapshot.id);
    snapshot.moved.forEach(cid => { const c = store.get('categories', cid); if (c && !c.folderId) store.put('categories', { id: cid, folderId: snapshot.id }); });
  });
}

/** 카테고리를 어느 묶음(folderId, 없으면 null)의 어느 자리로 옮긴다. refId 앞(after면 뒤), refId가 없으면 맨 뒤 */
export function moveCategoryTo(id, folderId, refId = null, after = false) {
  const c = store.get('categories', id);
  if (!c) return;
  const section = categoriesOf(c.kind).filter(x => (folderOfCategory(x) ?? null) === folderId && x.id !== id);
  let idx = refId ? section.findIndex(x => x.id === refId) : -1;
  idx = idx < 0 ? section.length : idx + (after ? 1 : 0);
  section.splice(idx, 0, c);
  store.batch(() => section.forEach((x, i) => {
    if (x.order !== i || (x.folderId ?? null) !== folderId) store.put('categories', { id: x.id, order: i, folderId });
  }));
}

/** 두 카테고리를 겹쳐 놓으면 묶음이 생긴다. 이름은 안에 든 이름으로 자동 ("운동·약") */
export function createGroupFrom(draggedId, targetId) {
  const a = store.get('categories', draggedId);
  const b = store.get('categories', targetId);
  if (!a || !b || a.kind !== b.kind) return null;
  const names = new Set(foldersOf(a.kind).map(f => f.name));
  const base = `${b.name}·${a.name}`.slice(0, MAX_NAME);
  let name = base;
  for (let i = 2; names.has(name); i++) name = `${base.slice(0, MAX_NAME - 2)} ${i}`;
  let folder = null;
  store.batch(() => {
    folder = addFolder(a.kind, name);
    moveCategoryTo(targetId, folder.id);
    moveCategoryTo(draggedId, folder.id, targetId, true);
  });
  return folder;
}

/** 비어 있는 묶음은 자동으로 없앤다. 반환값: 없앤 묶음 id들 (되돌리기용) */
export function cleanupEmptyFolders(kind) {
  const removed = [];
  for (const f of foldersOf(kind)) {
    if (!store.list('categories', c => c.folderId === f.id).length) {
      store.remove('catFolders', f.id);
      removed.push(f.id);
    }
  }
  return removed;
}

/** 관리 창에서 끌어서 정한 배치를 그대로 저장. layout: { folders: [id...], categories: [{ id, folderId }...] } (화면 순서) */
export function arrangeCategories(layout) {
  store.batch(() => {
    (layout.folders || []).forEach((id, i) => { const f = store.get('catFolders', id); if (f && f.order !== i) store.put('catFolders', { id, order: i }); });
    (layout.categories || []).forEach(({ id, folderId }, i) => {
      const c = store.get('categories', id);
      if (c && (c.order !== i || (c.folderId ?? null) !== folderId)) store.put('categories', { id, order: i, folderId });
    });
  });
}

export function categoryById(id, kind) {
  const c = id ? store.get('categories', id) : null;
  return c && c.kind === kind ? c : UNCATEGORIZED;
}

/** 항목의 카테고리 key: 카테고리 id, 없거나 지워졌으면 'none' */
export const categoryKey = (id, kind) => categoryById(id, kind).id ?? 'none';

function itemsOf(cat, includeSamples = true) {
  if (cat.kind === 'task') return store.list('tasks', t => t.category === cat.id);
  return [
    ...store.list('expenses', e => e.category === cat.id && (includeSamples || !e.sample)),
    ...store.list('recurring', r => r.category === cat.id),
  ];
}

export const usageCount = (cat, opts = {}) => itemsOf(cat, opts.includeSamples !== false).length;

/** v1(기본 카테고리 + 지출/수입 분리) → v2 한 번만 옮기기 */
export function migrateCategories() {
  if (loadPref('ple-cat-v2', false)) return;
  savePref('ple-cat-v2', true);
  const V1_DEFAULTS = ['work', 'personal', 'study', 'food', 'transport', 'cafe', 'shopping', 'living', 'etc', 'salary', 'allowance', 'income-etc'];
  store.batch(() => {
    const old = store.list('categories', c => c.kind === 'expense' || c.kind === 'income')
      .sort((a, b) => (a.kind === b.kind ? byOrder(a, b) : a.kind === 'expense' ? -1 : 1));
    old.forEach((c, i) => store.put('categories', { id: c.id, kind: 'ledger', order: i }));
    // 기본으로 넣었던 카테고리는: 실제로 쓰였으면 남기고, 예시에만 쓰였으면 예시 표시, 아무 데도 안 쓰였으면 지운다
    for (const id of V1_DEFAULTS) {
      const c = store.get('categories', id);
      if (!c) continue;
      if (usageCount(c, { includeSamples: false })) continue;
      if (usageCount(c)) store.put('categories', { id, sample: true });
      else store.remove('categories', id);
    }
  });
}

function checkName(kind, name, selfId) {
  const clean = String(name || '').trim().slice(0, MAX_NAME);
  if (!clean) throw new Error('이름을 입력해주세요.');
  if (clean === UNCATEGORIZED.name) throw new Error(`'${UNCATEGORIZED.name}'은 쓸 수 없는 이름이에요.`);
  if (categoriesOf(kind).some(c => c.name === clean && c.id !== selfId)) throw new Error('같은 이름의 카테고리가 이미 있어요.');
  return clean;
}

export function addCategory(kind, name, { slot = 0, id } = {}) {
  const list = categoriesOf(kind);
  if (list.length >= MAX_PER_KIND) throw new Error(`카테고리는 ${MAX_PER_KIND}개까지 만들 수 있어요.`);
  const clean = checkName(kind, name);
  const order = list.length ? Math.max(...list.map(c => c.order ?? 0)) + 1 : 0;
  return store.put('categories', { id: id || newCategoryId(), kind, name: clean, slot, order });
}

/** 이름이 들어 있으면 검사한다. id는 그대로라 과거 기록과 연결이 끊어지지 않는다 */
export function updateCategory(id, patch) {
  const cat = store.get('categories', id);
  if (!cat) return null;
  const next = { id, ...patch, sample: false };
  if ('name' in patch) next.name = checkName(cat.kind, patch.name, id);
  return store.put('categories', next);
}

/** 삭제: 이 카테고리를 쓰던 항목은 미분류(category: null)로 옮긴다.
 *  반환값: 되돌리기용 기록 { id, moved: { collection: [항목 id...] } } */
export function deleteCategory(id) {
  const cat = store.get('categories', id);
  if (!cat) return null;
  const collections = cat.kind === 'task' ? ['tasks'] : ['expenses', 'recurring'];
  const moved = {};
  store.batch(() => {
    for (const c of collections) {
      moved[c] = store.list(c, x => x.category === id).map(x => x.id);
      moved[c].forEach(itemId => store.put(c, { id: itemId, category: null }));
    }
    store.remove('categories', id);
  });
  return { id, moved };
}

/** 되돌리기: 카테고리를 살리고, 그때 옮겼던 항목을 다시 연결한다.
 *  그 사이 사용자가 다른 카테고리를 직접 지정한 항목은 건드리지 않는다 */
export function restoreCategory(snapshot) {
  if (!snapshot) return;
  store.batch(() => {
    store.restore('categories', snapshot.id);
    for (const [c, ids] of Object.entries(snapshot.moved)) {
      ids.forEach(itemId => {
        const item = store.get(c, itemId);
        if (item && item.category == null) store.put(c, { id: itemId, category: snapshot.id });
      });
    }
  });
}

/** 예시 카테고리를 실제로 쓰기 시작하면 예시 표시를 뗀다 (예시 지우기 때 같이 지워지지 않게) */
export function markCategoryUsed(id) {
  const c = id ? store.get('categories', id) : null;
  if (c?.sample) store.put('categories', { id, sample: false });
}

/** 고정 항목을 저장하면 그 카테고리에 설정을 기억 → 다음에 칩을 누르면 자동으로 채움 */
export function rememberPreset(id, preset) {
  const c = id ? store.get('categories', id) : null;
  if (c && c.kind === 'ledger') store.put('categories', { id, preset, sample: false });
}
