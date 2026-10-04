// 구글 캘린더 읽기 (Phase 4-1). 서버 없이 이 기기에서 구글 캘린더 API를 바로 부른다.
// - 보기만 한다 (쓰기는 4-2). 삼성·노션 캘린더와 같은 "구글 계정 일정"이 담다 달력에 함께 보인다.
// - 보고 있는 달 앞뒤를 달 단위로 받아 기기(IndexedDB)에 보관 → 인터넷이 없어도 보인다.
// - 받는 때: 연결할 때, 앱을 열 때·돌아올 때, 화면을 보는 동안 1분마다, 달을 넘길 때(아직 없는 달만).
// - 이 데이터는 드라이브 동기화에 넣지 않는다 (구글 캘린더 자체가 원본).
import * as google from './google.js';
import { getMeta, setMeta } from '../db.js';
import { loadPref, savePref, dateToKey, addDays, pad } from '../utils.js';

const API = 'https://www.googleapis.com/calendar/v3';
const ON_KEY = 'ple-gcal-on';
const SHOW_KEY = 'ple-gcal-show';   // { 캘린더 id: true/false } 사용자가 직접 바꾼 것만
const CACHE_KEY = 'gcal-cache';
const REFRESH_MS = 60 * 1000;

// 구글 일정 색 번호(colorId) → 색
const EVENT_COLORS = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
};
const safeHex = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#4285f4');

let cache = { calendars: [], months: {} }; // months: { 캘린더id: { 'YYYY-MM': { at, items } } }
let status = { phase: 'off', message: '', lastFetch: 0 };
let viewMonths = [];
let running = null;
const listeners = new Set();

export const isEnabled = () => !!loadPref(ON_KEY, false);
export const getStatus = () => ({ ...status });
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
function setStatus(phase, message = '') { status = { ...status, phase, message }; emit(); }

const monthKey = (y, m) => { const d = new Date(y, m, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

// ---- 보여줄 캘린더 ----
export function calendars() {
  const show = loadPref(SHOW_KEY, {});
  return cache.calendars.map(c => ({ ...c, visible: show[c.id] ?? c.selected }));
}
export function toggleCalendar(id) {
  const show = loadPref(SHOW_KEY, {});
  const cal = cache.calendars.find(c => c.id === id);
  if (!cal) return;
  show[id] = !(show[id] ?? cal.selected);
  savePref(SHOW_KEY, show);
  emit();
  if (show[id]) refresh({ force: false });
}

/** key 날짜에 걸친 구글 일정 (보이는 캘린더만) */
export function eventsOn(key) {
  if (!isEnabled()) return [];
  const mk = key.slice(0, 7);
  const out = [];
  const seen = new Set();
  for (const cal of calendars()) {
    if (!cal.visible) continue;
    for (const ev of cache.months[cal.id]?.[mk]?.items || []) {
      if (ev.start <= key && ev.end >= key && !seen.has(ev.id)) { seen.add(ev.id); out.push(ev); }
    }
  }
  return out;
}

// ---- 구글 캘린더 API ----
async function api(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${google.getToken()}` } });
  if (r.status === 401) { google.clearToken(); throw new google.NeedLogin(); }
  if (!r.ok) {
    let reason = '';
    try { const j = await r.json(); reason = j.error?.errors?.[0]?.reason || j.error?.status || ''; } catch {}
    if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') throw new Error('구글 클라우드에서 Google Calendar API를 켜야 해요.');
    if (r.status === 403) throw new Error('캘린더를 볼 권한이 없어요. 다시 연결하면서 캘린더 보기를 체크해 주세요.');
    throw new Error('구글 캘린더를 불러오지 못했어요.');
  }
  return r.json();
}

async function fetchCalendars() {
  const out = [];
  let pageToken;
  do {
    const j = await api('/users/me/calendarList', { maxResults: 250, pageToken, fields: 'items(id,summary,summaryOverride,backgroundColor,primary,selected,hidden),nextPageToken' });
    for (const c of j.items || []) {
      if (c.hidden) continue;
      out.push({ id: c.id, name: c.summaryOverride || c.summary || '캘린더', color: safeHex(c.backgroundColor), primary: !!c.primary, selected: c.selected !== false || !!c.primary });
    }
    pageToken = j.nextPageToken;
  } while (pageToken);
  out.sort((a, b) => Number(b.primary) - Number(a.primary));
  return out;
}

/** 구글 일정 → 담다 일정 모양 (end는 '포함하는 마지막 날') */
function normalize(ev, cal) {
  let start, end, time = '', endTime = '';
  if (ev.start?.date) {
    start = ev.start.date;
    end = ev.end?.date ? addDays(ev.end.date, -1) : start; // 종일 일정의 끝은 "다음 날"로 오므로 하루 빼기
  } else if (ev.start?.dateTime) {
    const s = new Date(ev.start.dateTime);
    const e = ev.end?.dateTime ? new Date(ev.end.dateTime) : s;
    start = dateToKey(s);
    end = e > s ? dateToKey(new Date(e - 1)) : start; // 자정에 끝나면 전날까지
    time = `${pad(s.getHours())}:${pad(s.getMinutes())}`;
    endTime = `${pad(e.getHours())}:${pad(e.getMinutes())}`;
  } else return null;
  if (end < start) end = start;
  return {
    id: `g:${cal.id}:${ev.id}`,
    source: 'google',
    title: ev.summary || '(제목 없음)',
    start, end, time, endTime,
    color: ev.colorId ? EVENT_COLORS[ev.colorId] || cal.color : cal.color,
    calName: cal.name,
    link: /^https:\/\/(www\.)?google\.com\/calendar\//.test(ev.htmlLink || '') ? ev.htmlLink : '',
    recurring: !!ev.recurringEventId,
  };
}

async function fetchMonth(cal, mk) {
  const [y, m] = mk.split('-').map(Number);
  const items = [];
  let pageToken;
  do {
    const j = await api(`/calendars/${encodeURIComponent(cal.id)}/events`, {
      singleEvents: 'true', orderBy: 'startTime', maxResults: 250, pageToken,
      timeMin: new Date(y, m - 1, 1).toISOString(), timeMax: new Date(y, m, 1).toISOString(),
      fields: 'items(id,summary,start,end,htmlLink,colorId,status,recurringEventId),nextPageToken',
    });
    for (const ev of j.items || []) {
      if (ev.status === 'cancelled') continue;
      const n = normalize(ev, cal);
      if (n) items.push(n);
    }
    pageToken = j.nextPageToken;
  } while (pageToken);
  (cache.months[cal.id] ||= {})[mk] = { at: Date.now(), items };
}

async function saveCache() {
  try { await setMeta(CACHE_KEY, cache); } catch {}
}

/** 받아오기. force가 아니면 1분 안에 받은 달은 건너뛴다 */
export function refresh({ force = true } = {}) {
  if (running) return running;
  running = (async () => {
    if (!isEnabled()) return setStatus('off');
    if (!google.hasToken()) return setStatus('need-login', '구글 로그인이 끝나면 일정을 불러와요');
    if (!google.hasScope(google.CAL_READ)) return setStatus('need-scope', '캘린더 보기 권한이 없어요');
    const today = new Date();
    const months = [...new Set([...viewMonths, monthKey(today.getFullYear(), today.getMonth())])];
    if (status.phase !== 'ok') setStatus('loading');
    try {
      cache.calendars = await fetchCalendars();
      for (const cal of calendars()) {
        if (!cal.visible) continue;
        for (const mk of months) {
          const got = cache.months[cal.id]?.[mk];
          if (!force && got && Date.now() - got.at < REFRESH_MS) continue;
          await fetchMonth(cal, mk);
        }
      }
      // 사라진 캘린더의 보관분은 지운다
      for (const id of Object.keys(cache.months)) if (!cache.calendars.some(c => c.id === id)) delete cache.months[id];
      status.lastFetch = Date.now();
      await saveCache();
      setStatus('ok');
    } catch (err) {
      if (err instanceof google.NeedLogin) setStatus('need-login', '구글 로그인이 끝나면 일정을 불러와요');
      else setStatus('error', err.message || '구글 캘린더를 불러오지 못했어요');
    }
  })().finally(() => { running = null; });
  return running;
}

/** 캘린더 화면이 보고 있는 달을 알려준다 → 그 달과 앞뒤 달을 준비 */
export function setViewMonth(y, m) {
  const next = [monthKey(y, m - 1), monthKey(y, m), monthKey(y, m + 1)];
  if (next.join() === viewMonths.join()) return;
  viewMonths = next;
  if (isEnabled()) refresh({ force: false });
}

// ---- 연결 · 끊기 ----
/** 버튼을 누른 직후에 불러야 한다 (구글 창이 막히지 않게) */
export async function connectCalendar(hintEmail = '') {
  google.wantScope(google.CAL_READ, true);
  await google.signIn(hintEmail);
  if (!google.hasScope(google.CAL_READ)) {
    throw new Error('캘린더 보기 권한이 체크되지 않았어요. 다시 연결하면서 체크해 주세요.');
  }
  savePref(ON_KEY, true);
  await refresh();
  return calendars().filter(c => c.visible).length;
}

export async function disconnectCalendar() {
  google.wantScope(google.CAL_READ, false);
  savePref(ON_KEY, false);
  cache = { calendars: [], months: {} };
  status = { phase: 'off', message: '', lastFetch: 0 };
  await saveCache();
  emit();
}

// ---- 시작 ----
(async () => {
  try { const saved = await getMeta(CACHE_KEY); if (saved?.months) { cache = saved; emit(); } } catch {}
  if (isEnabled()) refresh({ force: false });
})();
setInterval(() => { if (isEnabled() && document.visibilityState === 'visible') refresh({ force: true }); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (isEnabled() && document.visibilityState === 'visible') refresh({ force: false }); });
window.addEventListener('online', () => { if (isEnabled()) refresh({ force: false }); });
window.addEventListener('ple:google-signin', () => { if (isEnabled()) setTimeout(() => refresh({ force: false }), 0); });
