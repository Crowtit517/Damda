// IndexedDB 도우미 (기기 저장소의 "서랍장").
// 항목 하나 = 레코드 하나 ({ key: '컬렉션/아이디', c, item }). 바뀐 항목만 골라 저장한다.
// 외부 라이브러리 없이 브라우저 기본 기능만 쓴다.

const DB_NAME = 'damda';
const DB_VERSION = 1;
const ITEMS = 'items';
const META = 'meta';
const OPEN_TIMEOUT = 3000; // 이 안에 열리지 않으면 예전 방식(localStorage)으로 쓴다

let dbPromise = null;

const req2promise = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const txDone = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('저장이 취소됐어요'));
});

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window) || !window.indexedDB) return reject(new Error('IndexedDB를 쓸 수 없어요'));
    const timer = setTimeout(() => reject(new Error('IndexedDB가 열리지 않아요')), OPEN_TIMEOUT);
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { clearTimeout(timer); return reject(e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      // 다른 탭이 새 버전으로 열려고 하면 닫아서 막지 않는다
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => { clearTimeout(timer); reject(req.error); };
    req.onblocked = () => { clearTimeout(timer); reject(new Error('IndexedDB가 다른 탭에 막혀 있어요')); };
  }).catch(err => { dbPromise = null; throw err; });
  return dbPromise;
}

/** 저장된 전체 항목 → { 컬렉션: { 아이디: 항목 } } */
export async function readAll(collections) {
  const db = await openDb();
  const rows = await req2promise(db.transaction(ITEMS, 'readonly').objectStore(ITEMS).getAll());
  const out = {};
  for (const c of collections) out[c] = {};
  for (const row of rows) if (out[row.c] && row.item?.id) out[row.c][row.item.id] = row.item;
  return out;
}

/** 여러 항목을 한 번에 저장. list: [[컬렉션, 항목], ...] */
export async function writeItems(list) {
  if (!list.length) return;
  const db = await openDb();
  const tx = db.transaction(ITEMS, 'readwrite');
  const os = tx.objectStore(ITEMS);
  for (const [c, item] of list) os.put({ key: `${c}/${item.id}`, c, item });
  await txDone(tx);
}

export async function getMeta(name) {
  const db = await openDb();
  return req2promise(db.transaction(META, 'readonly').objectStore(META).get(name));
}

export async function setMeta(name, value) {
  const db = await openDb();
  const tx = db.transaction(META, 'readwrite');
  tx.objectStore(META).put(value, name);
  await txDone(tx);
}
