// 동기화 엔진: 기기 먼저 저장(local-first) → 뒤에서 구글 드라이브의 데이터 파일과 맞춘다. 서버 없음.
//
// 한 번 맞추기(syncNow):
//   1) 드라이브 파일의 버전을 가볍게 확인 → 바뀌었으면 받아서 항목별로 합친다 (updatedAt이 나중인 쪽이 남음).
//   2) 이 기기에 올리지 않은 변경이 있으면, 올리기 직전에 버전을 한 번 더 확인하고(다른 기기가 방금 올렸으면 다시 합침) 올린다.
// 방식(☰ 메뉴에서 고름):
//   auto   저장 후 1초 안에 올리고, 화면이 보이는 동안 5초마다 확인, 열 때·돌아올 때 즉시
//   saver  열 때·돌아올 때·화면을 떠날 때만
//   manual [지금 맞추기]를 누를 때만
//   local  맞추지 않음
import { store } from '../store.js';
import * as googleApi from './google.js';
import * as driveApi from './drive.js';
import { loadPref, savePref } from '../utils.js';

const MODE_KEY = 'ple-sync-mode';
const ACCOUNT_KEY = 'ple-google';
const STATE_KEY = 'ple-sync-state';
const DIRTY_KEY = 'ple-sync-dirty';
const COLLECTIONS = ['tasks', 'expenses', 'events', 'categories', 'recurring', 'taskRules', 'catFolders'];

/** 테스트에서 가짜 드라이브로 바꿔 끼울 수 있게 */
export const adapters = { google: googleApi, drive: driveApi };

let state = loadPref(STATE_KEY, {});          // { fileId, version, lastSync }
let dirty = loadPref(DIRTY_KEY, true);        // 올리지 않은 변경이 있나 (처음엔 있다고 보고 한 번 올림)
let applyingRemote = false;
let running = null;
let pollTimer = null;
let uploadTimer = null;
let status = { phase: 'off', message: '' };
const listeners = new Set();

export const syncMode = () => loadPref(MODE_KEY, 'local');
export const account = () => loadPref(ACCOUNT_KEY, null);       // { email }
export const isConnected = () => !!account();
export const getStatus = () => ({ ...status, lastSync: state.lastSync || null });
export const onStatus = fn => { listeners.add(fn); return () => listeners.delete(fn); };

function setStatus(phase, message = '') {
  status = { phase, message };
  if (phase === 'need-login') armAutoRelogin();
  listeners.forEach(fn => { try { fn(getStatus()); } catch (e) { console.error(e); } });
}
function saveState() { savePref(STATE_KEY, state); }
function setDirty(v) { dirty = v; savePref(DIRTY_KEY, v); }

// 이 기기에서 무언가 바뀌면 (구글에서 받아 합친 변경은 제외)
store.subscribe(() => {
  if (applyingRemote) return;
  setDirty(true);
  if (syncMode() === 'auto') scheduleUpload(1000);
});

function scheduleUpload(ms) {
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => syncNow(), ms);
}

/** 받은 데이터와 합친 뒤에도 이 기기 쪽이 더 새로운 항목이 있으면 올려야 한다 */
function localHasNewer(remote) {
  const local = store.exportData();
  return COLLECTIONS.some(c => Object.values(local[c] || {}).some(item => {
    const r = remote?.[c]?.[item.id];
    return !r || (Number(item.updatedAt) || 0) > (Number(r.updatedAt) || 0);
  }));
}

function mergeRemote(remote) {
  applyingRemote = true;
  try { store.importData(remote); } finally { applyingRemote = false; }
  if (localHasNewer(remote)) setDirty(true);
}

/** 지금 한 번 맞추기. 이미 진행 중이면 그 작업을 기다린다 */
export function syncNow() {
  if (running) return running;
  running = (async () => {
    if (syncMode() === 'local' || !isConnected()) return setStatus('off');
    const { drive, google } = adapters;
    if (!google.hasToken()) return setStatus('need-login', '다시 로그인하면 이어서 맞춰요');
    setStatus('syncing');
    try {
      let meta = state.fileId ? await drive.getMeta(state.fileId) : null;
      if (!meta) meta = await drive.findFile();

      if (meta && meta.version !== state.version) {
        mergeRemote(await drive.download(meta.id));
        state = { ...state, fileId: meta.id, version: meta.version };
      }

      if (dirty || !meta) {
        if (meta) {
          // 올리기 직전에 다른 기기가 먼저 올렸는지 한 번 더 확인
          const latest = await drive.getMeta(meta.id);
          if (latest && latest.version !== state.version) {
            mergeRemote(await drive.download(latest.id));
            state = { ...state, version: latest.version };
          }
        }
        const data = store.exportData();
        const saved = meta ? await drive.update(meta.id, data) : await drive.create(data);
        state = { ...state, fileId: saved.id, version: saved.version };
        setDirty(false);
      }
      state.lastSync = Date.now();
      saveState();
      setStatus('ok');
    } catch (err) {
      if (err instanceof google.NeedLogin) setStatus('need-login', '다시 로그인하면 이어서 맞춰요');
      else setStatus('error', err.message || '맞추지 못했어요');
    }
  })().finally(() => { running = null; });
  return running;
}

// ---- 방식에 따라 언제 맞출지 ----
function onVisibility() {
  const mode = syncMode();
  if (mode !== 'auto' && mode !== 'saver') return;
  if (document.visibilityState === 'visible') syncNow();
  else if (dirty) syncNow(); // 화면을 떠날 때 남은 변경을 올려 둔다
}
document.addEventListener('visibilitychange', onVisibility);
window.addEventListener('online', () => { if (syncMode() !== 'manual') syncNow(); });

/** 방식·연결이 바뀌거나 앱이 켜질 때 다시 설정 */
export function startSync() {
  clearInterval(pollTimer);
  clearTimeout(uploadTimer);
  const mode = syncMode();
  if (mode === 'local' || !isConnected()) return setStatus(mode === 'local' ? 'off' : 'waiting');
  if (mode === 'auto') {
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 5000);
  }
  if (mode !== 'manual') syncNow();
  else setStatus(adapters.google.hasToken() ? 'ok' : 'need-login', adapters.google.hasToken() ? '' : '다시 로그인하면 맞출 수 있어요');
}

export function setSyncMode(mode) {
  savePref(MODE_KEY, mode);
  startSync();
}

// ---- 로그인 만료 → 다음 터치에서 자동으로 다시 받기 ----
// 브라우저는 사용자가 누른 직후에만 로그인 창을 열 수 있다. 그래서 만료되면 '다음 클릭'을 기다렸다가
// 조용히 다시 받는다 (계정 선택·비밀번호 없이, 창이 잠깐 깜빡임). 실패하면 이번 실행에서는 다시 시도하지 않고
// [다시 로그인] 버튼으로 맡긴다.
let autoArmed = false;
let autoGaveUp = false;

function armAutoRelogin() {
  if (autoArmed || autoGaveUp || !isConnected() || syncMode() === 'local') return;
  autoArmed = true;
  adapters.google.loadGis?.().catch(() => {});
  document.addEventListener('click', onNextClick, { capture: true, once: true });
}

async function onNextClick(e) {
  autoArmed = false;
  // 직접 누른 연결 버튼은 그 버튼이 처리한다
  if (e.target.closest?.('[data-act="google-reconnect"], [data-act="google-disconnect"], [data-act="google-connect"]')) return;
  if (adapters.google.hasToken() || !isConnected()) return;
  try {
    await reconnectGoogle();
  } catch {
    autoGaveUp = true;
    setStatus('need-login', '다시 로그인하면 이어서 맞춰요');
  }
}

// ---- 연결 · 끊기 ----
export async function connectGoogle() {
  const { google } = adapters;
  await google.signIn(account()?.email || '');
  autoGaveUp = false;
  const email = await google.fetchEmail().catch(() => '');
  savePref(ACCOUNT_KEY, { email, connectedAt: Date.now() });
  if (syncMode() === 'local') savePref(MODE_KEY, 'auto'); // 처음 연결하면 추천 방식으로
  setDirty(true); // 이 기기 데이터도 한 번 올려서 합친다
  startSync();
  return email;
}

/** 로그인만 다시 (만료됐을 때). 계정은 그대로 */
export async function reconnectGoogle() {
  await adapters.google.signIn(account()?.email || '');
  autoGaveUp = false;
  startSync();
}

/** 연결 끊기: 이 기기의 데이터는 그대로 두고, 구글과 맞추는 것만 멈춘다 */
export function disconnectGoogle() {
  adapters.google.signOut();
  savePref(ACCOUNT_KEY, null);
  savePref(MODE_KEY, 'local');
  state = {};
  saveState();
  setDirty(true);
  startSync();
}
