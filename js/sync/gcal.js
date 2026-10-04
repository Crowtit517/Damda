// 구글 캘린더 양방향 동기화 (Phase 4). 서버 없이 이 기기에서 구글 캘린더 API를 바로 부른다.
// - 일정만 주고받는다. 할 일·가계부는 담다(드라이브 숨김 폴더)에만 있다.
// - 읽기: 보고 있는 달 ± 1달 + 이번 달을 받아 기기(IndexedDB)에 보관 → 인터넷이 없어도 보인다.
//   열 때·돌아올 때·화면을 보는 동안 1분마다·로그인 직후에 다시 받는다.
// - 쓰기: 담다에서 만들고 고치고 지운 일정은 "보낼 목록(outbox)"에 넣고 순서대로 구글에 보낸다.
//   새 일정은 아이디를 미리 정해 두어 다시 보내도 하나만 생기고, 고칠 때는 버전(etag)을 확인해
//   다른 곳에서 먼저 고친 일정은 덮어쓰지 않는다. 지우기는 8초 동안 되돌릴 수 있다.
// - 담다에만 있던 일정(캘린더 연결 전에 만든 것)은 쓸 수 있게 되면 저절로 구글로 옮긴다.
//   담다 일정 아이디로 정한 고정 구글 아이디를 써서, 두 기기가 동시에 옮겨도 하나만 생긴다.
// - 반복 일정, 공휴일, 남이 공유한 캘린더처럼 수정 권한이 없는 일정은 보기만 한다.
// - 계정: 기본 계정(드라이브 동기화 계정) + 캘린더만 보는 추가 구글 계정 여러 개.
import * as google from './google.js';
import { store, dataPlace } from '../store.js';
import { findFile, create as createDriveFile } from './drive.js';
import { getMeta, setMeta } from '../db.js';
import { loadPref, savePref, dateToKey, keyToDate, addDays, pad } from '../utils.js';

const API = 'https://www.googleapis.com/calendar/v3';
const ON_KEY = 'ple-gcal-on';
const SHOW_KEY = 'ple-gcal-show2';    // { '계정|캘린더': true/false } 사용자가 직접 바꾼 것만
const TARGET_KEY = 'ple-gcal-target'; // 새 일정을 저장할 '계정|캘린더'
const EXTRA_KEY = 'ple-gcal-extra';   // 추가 계정 토큰 { 이메일: { token, exp, scope } }
const CACHE_KEY = 'gcal-cache-v2';
const OUTBOX_KEY = 'gcal-outbox';
const REFRESH_MS = 60 * 1000;
const UNDO_MS = 8000;
const MAIN = 'main';

// 구글 일정 색 번호(colorId) → 색
export const GOOGLE_COLORS = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
};
const safeHex = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#4285f4');

let cache = { accounts: {} };      // { 계정: { calendars: [...], months: { 캘린더: { 'YYYY-MM': { at, items } } } } }
let outbox = [];                   // [{ op, acct, calId, gid, body, etag }]
let status = { phase: 'off', message: '', lastFetch: 0, accounts: {} };
let viewMonths = [];
let running = null;
let sending = null;
const pendingDeletes = new Map();  // 일정 id → { ev, timer }
const listeners = new Set();

// 켜짐 여부: 사용자가 [캘린더 연결 끊기]로 직접 끈 경우(false)만 꺼 두고, 그 외에는 구글 계정이 연결돼 있으면 켠다
export const isEnabled = () => { const v = loadPref(ON_KEY, null); return v === null ? !!mainEmail() : !!v; };
export const getStatus = () => ({ ...status, accounts: { ...status.accounts }, outbox: outbox.length });
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
const notice = message => window.dispatchEvent(new CustomEvent('ple:gcal-notice', { detail: message }));
function setStatus(phase, message = '') { status = { ...status, phase, message }; emit(); }

const monthKey = (y, m) => { const d = new Date(y, m, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul'; } catch { return 'Asia/Seoul'; } };

// ---- 계정 ----
const extras = () => loadPref(EXTRA_KEY, {}) || {};
const mainEmail = () => loadPref('ple-google', null)?.email || '';

export function accounts() {
  const list = [{ key: MAIN, email: mainEmail(), main: true }];
  for (const email of Object.keys(extras())) list.push({ key: email, email, main: false });
  return list;
}

function tokenOf(key) {
  if (key === MAIN) return google.hasToken() ? { token: google.getToken(), scope: '' } : null;
  const t = extras()[key];
  return t && t.exp > Date.now() ? t : null;
}

function hasScopeOf(key, scope) {
  if (key === MAIN) return google.hasScope(scope);
  const t = tokenOf(key);
  return !!t && (t.scope || '').split(' ').includes(scope);
}
const canRead = key => hasScopeOf(key, google.CAL_READ);
const canWriteAcct = key => hasScopeOf(key, google.CAL_WRITE);

// ---- 보여줄 캘린더 ----
export function calendars() {
  const show = loadPref(SHOW_KEY, {});
  const out = [];
  for (const acc of accounts()) {
    for (const c of cache.accounts[acc.key]?.calendars || []) {
      out.push({ ...c, acct: acc.key, accountEmail: acc.email, visible: show[`${acc.key}|${c.id}`] ?? c.selected });
    }
  }
  return out;
}

export function toggleCalendar(acct, id) {
  const show = loadPref(SHOW_KEY, {});
  const cal = calendars().find(c => c.acct === acct && c.id === id);
  if (!cal) return;
  show[`${acct}|${id}`] = !cal.visible;
  savePref(SHOW_KEY, show);
  emit();
  if (!cal.visible) refresh({ force: false });
}

/** 새 일정을 저장할 수 있는 캘린더 (수정 권한이 있고 계정 토큰에 쓰기 권한이 있는 것) */
export function writableCalendars() {
  return calendars().filter(c => c.writable && canWriteAcct(c.acct));
}

export function target() {
  const list = writableCalendars();
  const saved = loadPref(TARGET_KEY, '');
  return list.find(c => `${c.acct}|${c.id}` === saved)
    || list.find(c => c.acct === MAIN && c.primary)
    || list[0] || null;
}
/** 일정 담는 곳 정하기. 고른 캘린더는 담다에서 저절로 보이게 한다 (만든 일정이 안 보이는 일이 없게) */
export function setTarget(acct, id) {
  savePref(TARGET_KEY, `${acct}|${id}`);
  const show = loadPref(SHOW_KEY, {});
  show[`${acct}|${id}`] = true;
  savePref(SHOW_KEY, show);
  emit();
  refresh({ force: false });
}

/** 담다에서 만든 일정을 구글 캘린더에 저장할 수 있나 */
export const canWrite = () => isEnabled() && !!target();

/** key 날짜에 걸친 구글 일정 (보이는 캘린더만, 지우는 중인 것 제외) */
export function eventsOn(key) {
  if (!isEnabled()) return [];
  const mk = key.slice(0, 7);
  const out = [];
  const seen = new Set();
  for (const cal of calendars()) {
    if (!cal.visible) continue;
    for (const ev of cache.accounts[cal.acct]?.months?.[cal.id]?.[mk]?.items || []) {
      if (ev.start <= key && ev.end >= key && !seen.has(ev.id) && !pendingDeletes.has(ev.id)) { seen.add(ev.id); out.push(ev); }
    }
  }
  return out;
}

// ---- 구글 캘린더 API ----
class Conflict extends Error {}

async function api(acct, path, { method = 'GET', params = {}, body, etag, keepalive = false } = {}) {
  const t = tokenOf(acct);
  if (!t) throw new google.NeedLogin();
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const headers = { Authorization: `Bearer ${t.token}` };
  if (body) headers['Content-Type'] = 'application/json';
  if (etag) headers['If-Match'] = etag;
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, keepalive });
  if (r.status === 401) {
    if (acct === MAIN) google.clearToken();
    else { const x = extras(); if (x[acct]) { x[acct] = { ...x[acct], exp: 0 }; savePref(EXTRA_KEY, x); } }
    throw new google.NeedLogin();
  }
  if (r.status === 409 || r.status === 412) throw new Conflict(String(r.status));
  if (method === 'DELETE' && (r.status === 404 || r.status === 410)) return null;
  if (!r.ok) {
    let reason = '';
    try { const j = await r.json(); reason = j.error?.errors?.[0]?.reason || j.error?.status || ''; } catch {}
    if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') throw new Error('구글 클라우드에서 Google Calendar API를 켜야 해요.');
    if (r.status === 403) throw new Error('이 캘린더에 대한 권한이 없어요.');
    const err = new Error('구글 캘린더와 주고받지 못했어요.');
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}

async function fetchCalendars(acct) {
  const out = [];
  let pageToken;
  do {
    const j = await api(acct, '/users/me/calendarList', { params: { maxResults: 250, pageToken, fields: 'items(id,summary,summaryOverride,backgroundColor,primary,selected,hidden,accessRole),nextPageToken' } });
    for (const c of j.items || []) {
      if (c.hidden) continue;
      out.push({
        id: c.id, name: c.summaryOverride || c.summary || '캘린더', color: safeHex(c.backgroundColor),
        primary: !!c.primary, selected: c.selected !== false || !!c.primary,
        writable: c.accessRole === 'owner' || c.accessRole === 'writer',
      });
    }
    pageToken = j.nextPageToken;
  } while (pageToken);
  out.sort((a, b) => Number(b.primary) - Number(a.primary));
  return out;
}

const EVENT_FIELDS = 'id,etag,summary,start,end,htmlLink,colorId,status,recurringEventId,reminders';

/** 구글 일정 → 담다 일정 모양 (end는 '포함하는 마지막 날') */
function normalize(ev, cal, acct) {
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
  const r = ev.reminders;
  return {
    id: `g:${acct}:${cal.id}:${ev.id}`,
    source: 'google', acct, calId: cal.id, gid: ev.id, etag: ev.etag || '',
    title: ev.summary || '(제목 없음)',
    start, end, time, endTime,
    colorId: ev.colorId || '',
    color: ev.colorId ? GOOGLE_COLORS[ev.colorId] || cal.color : cal.color,
    calName: cal.name,
    link: /^https:\/\/(www\.)?google\.com\/calendar\//.test(ev.htmlLink || '') ? ev.htmlLink : '',
    recurring: !!ev.recurringEventId,
    writable: !!cal.writable && !ev.recurringEventId,
    reminder: !r || r.useDefault ? 'default' : r.overrides?.length ? String(r.overrides[0].minutes) : 'none',
  };
}

async function fetchMonth(acct, cal, mk) {
  const [y, m] = mk.split('-').map(Number);
  const items = [];
  let pageToken;
  do {
    const j = await api(acct, `/calendars/${encodeURIComponent(cal.id)}/events`, {
      params: {
        singleEvents: 'true', orderBy: 'startTime', maxResults: 250, pageToken,
        timeMin: new Date(y, m - 1, 1).toISOString(), timeMax: new Date(y, m, 1).toISOString(),
        fields: `items(${EVENT_FIELDS}),nextPageToken`,
      },
    });
    for (const ev of j.items || []) {
      if (ev.status === 'cancelled') continue;
      const n = normalize(ev, cal, acct);
      if (n) items.push(n);
    }
    pageToken = j.nextPageToken;
  } while (pageToken);
  // 아직 구글에 보내지 못한 일정은 화면에서 사라지지 않게 그대로 둔다
  const old = cache.accounts[acct].months[cal.id]?.[mk]?.items || [];
  for (const p of old) if (p.pending && !items.some(x => x.id === p.id)) items.push(p);
  (cache.accounts[acct].months[cal.id] ||= {})[mk] = { at: Date.now(), items };
}

// ---- 보관함 안의 일정 하나 넣기·빼기 ----
function monthsOf(ev) {
  const out = [];
  let d = keyToDate(ev.start);
  const last = keyToDate(ev.end);
  while (d <= last) { out.push(monthKey(d.getFullYear(), d.getMonth())); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  return out;
}

function removeFromCache(id) {
  for (const acc of Object.values(cache.accounts)) {
    for (const byMonth of Object.values(acc.months || {})) {
      for (const slot of Object.values(byMonth)) slot.items = slot.items.filter(x => x.id !== id);
    }
  }
}

function putInCache(ev) {
  removeFromCache(ev.id);
  const acc = (cache.accounts[ev.acct] ||= { calendars: [], months: {} });
  const byMonth = (acc.months[ev.calId] ||= {});
  for (const mk of monthsOf(ev)) (byMonth[mk] ||= { at: 0, items: [] }).items.push(ev);
}

function findEvent(id) {
  for (const acc of Object.values(cache.accounts)) {
    for (const byMonth of Object.values(acc.months || {})) {
      for (const slot of Object.values(byMonth)) { const ev = slot.items.find(x => x.id === id); if (ev) return ev; }
    }
  }
  return null;
}

async function saveCache() {
  try { await setMeta(CACHE_KEY, cache); } catch {}
}
async function saveOutbox() {
  try { await setMeta(OUTBOX_KEY, outbox); } catch {}
}

// ---- 받아오기 ----
/** force가 아니면 1분 안에 받은 달은 건너뛴다 */
export function refresh({ force = true } = {}) {
  if (running) return running;
  running = (async () => {
    if (!isEnabled()) return setStatus('off');
    const today = new Date();
    const months = [...new Set([...viewMonths, monthKey(today.getFullYear(), today.getMonth())])];
    const states = {};
    let anyOk = false;
    let lastError = '';
    if (status.phase !== 'ok') setStatus('loading');
    for (const acc of accounts()) {
      if (!tokenOf(acc.key)) { states[acc.key] = 'need-login'; continue; }
      if (!canRead(acc.key)) { states[acc.key] = 'need-scope'; continue; }
      try {
        const cals = await fetchCalendars(acc.key);
        cache.accounts[acc.key] = { calendars: cals, months: cache.accounts[acc.key]?.months || {} };
        for (const cal of calendars().filter(c => c.acct === acc.key && c.visible)) {
          for (const mk of months) {
            const got = cache.accounts[acc.key].months[cal.id]?.[mk];
            if (!force && got && Date.now() - got.at < REFRESH_MS) continue;
            await fetchMonth(acc.key, cal, mk);
          }
        }
        // 사라진 캘린더의 보관분은 지운다
        for (const id of Object.keys(cache.accounts[acc.key].months)) {
          if (!cals.some(c => c.id === id)) delete cache.accounts[acc.key].months[id];
        }
        states[acc.key] = canWriteAcct(acc.key) ? 'ok' : 'read-only';
        anyOk = true;
      } catch (err) {
        states[acc.key] = err instanceof google.NeedLogin ? 'need-login' : 'error';
        if (!(err instanceof google.NeedLogin)) lastError = err.message;
      }
    }
    // 연결을 끊은 계정의 보관분은 지운다
    for (const key of Object.keys(cache.accounts)) if (!accounts().some(a => a.key === key)) delete cache.accounts[key];
    status.accounts = states;
    if (anyOk) status.lastFetch = Date.now();
    await saveCache();
    const main = states[MAIN];
    if (anyOk) setStatus('ok');
    else if (lastError) setStatus('error', lastError);
    else if (main === 'need-scope') setStatus('need-scope', '캘린더 권한이 없어요');
    else setStatus('need-login', '구글 로그인이 끝나면 일정을 불러와요');
    armRelogin();
    if (anyOk) await autoMigrate();
    sendOutbox();
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

// ---- 쓰기 ----
const newGid = () => {
  // 구글 일정 아이디 규칙: 소문자 a~v, 숫자 0~9 (base32hex), 5~1024자
  const chars = '0123456789abcdefghijklmnopqrstuv';
  let s = 'damda';
  const rnd = crypto.getRandomValues(new Uint8Array(20));
  for (const b of rnd) s += chars[b % 32];
  return s;
};

function plusHour(dateKey, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = keyToDate(dateKey);
  d.setHours(h + 1, m, 0, 0);
  return { date: dateToKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** 담다 입력 → 구글 일정 본문 */
function toGoogleBody(input) {
  const body = { summary: input.title };
  if (!input.time) {
    body.start = { date: input.start };
    body.end = { date: addDays(input.end || input.start, 1) };
  } else {
    let endDate = input.end || input.start;
    let endTime = input.endTime;
    if (!endTime || (endDate === input.start && endTime <= input.time)) {
      const p = plusHour(input.start, input.time);
      if (endDate === input.start) endDate = p.date;
      endTime = p.time;
    }
    body.start = { dateTime: `${input.start}T${input.time}:00`, timeZone: tz() };
    body.end = { dateTime: `${endDate}T${endTime}:00`, timeZone: tz() };
  }
  body.colorId = input.colorId || null;
  const rem = input.reminder || 'default';
  body.reminders = rem === 'default' ? { useDefault: true }
    : rem === 'none' ? { useDefault: false, overrides: [] }
    : { useDefault: false, overrides: [{ method: 'popup', minutes: Number(rem) }] };
  return body;
}

/** 화면에 바로 보이게 만든 임시 일정 (구글에 보내는 중) */
function optimistic(input, { acct, calId, gid, prev }) {
  const cal = calendars().find(c => c.acct === acct && c.id === calId) || { id: calId, name: '', color: '#4285f4', writable: true };
  return {
    ...(prev || {}),
    id: `g:${acct}:${calId}:${gid}`, source: 'google', acct, calId, gid, etag: prev?.etag || '',
    title: input.title, start: input.start, end: input.end || input.start,
    time: input.time || '', endTime: input.time ? (input.endTime || plusHour(input.start, input.time).time) : '',
    colorId: input.colorId || '', color: input.colorId ? GOOGLE_COLORS[input.colorId] : cal.color,
    calName: cal.name, link: prev?.link || '', recurring: false, writable: true,
    reminder: input.reminder || 'default', pending: true,
  };
}

export async function createEvent(input, { gid = newGid() } = {}) {
  const t = target();
  if (!t) throw new Error('일정을 저장할 구글 캘린더가 없어요.');
  const body = { ...toGoogleBody(input), id: gid };
  putInCache(optimistic(input, { acct: t.acct, calId: t.id, gid }));
  outbox.push({ op: 'insert', acct: t.acct, calId: t.id, gid, body });
  await saveOutbox();
  emit();
  sendOutbox();
  return t;
}

export async function updateEvent(ev, input) {
  if (!ev.writable) throw new Error('이 일정은 원래 캘린더에서 고쳐 주세요.');
  const body = toGoogleBody(input);
  putInCache(optimistic(input, { acct: ev.acct, calId: ev.calId, gid: ev.gid, prev: ev }));
  // 아직 보내지 않은 새 일정이면 그 본문을 바꾸고, 아니면 고치기를 보낸다
  const queued = outbox.find(o => o.op === 'insert' && o.gid === ev.gid);
  if (queued) queued.body = { ...body, id: ev.gid };
  else outbox.push({ op: 'patch', acct: ev.acct, calId: ev.calId, gid: ev.gid, body, etag: ev.etag });
  await saveOutbox();
  emit();
  sendOutbox();
}

/** 지우기: 화면에서 바로 숨기고 8초 뒤 구글에서 지운다. 반환값: 되돌리기 함수 */
export function deleteEvent(ev) {
  if (!ev.writable) throw new Error('이 일정은 원래 캘린더에서 지워 주세요.');
  const timer = setTimeout(() => commitDelete(ev.id), UNDO_MS);
  pendingDeletes.set(ev.id, { ev, timer });
  emit();
  return () => {
    const p = pendingDeletes.get(ev.id);
    if (!p) return;
    clearTimeout(p.timer);
    pendingDeletes.delete(ev.id);
    emit();
  };
}

function commitDelete(id, { keepalive = false } = {}) {
  const p = pendingDeletes.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pendingDeletes.delete(id);
  const { ev } = p;
  removeFromCache(ev.id);
  const queuedInsert = outbox.findIndex(o => o.op === 'insert' && o.gid === ev.gid);
  if (queuedInsert >= 0) outbox.splice(queuedInsert, 1); // 아직 안 보낸 새 일정이면 보내지 않으면 끝
  else outbox.push({ op: 'delete', acct: ev.acct, calId: ev.calId, gid: ev.gid });
  saveOutbox();
  saveCache();
  emit();
  sendOutbox({ keepalive });
}

async function refetchOne(o) {
  const cal = calendars().find(c => c.acct === o.acct && c.id === o.calId);
  if (!cal) return;
  try {
    const ev = await api(o.acct, `/calendars/${encodeURIComponent(o.calId)}/events/${encodeURIComponent(o.gid)}`, { params: { fields: EVENT_FIELDS } });
    if (ev && ev.status !== 'cancelled') { const n = normalize(ev, cal, o.acct); if (n) putInCache(n); }
    else removeFromCache(`g:${o.acct}:${o.calId}:${o.gid}`);
  } catch {}
}

/** 보낼 목록을 순서대로 구글에 보낸다. 인터넷이 없거나 로그인이 필요하면 다음에 다시 */
export function sendOutbox({ keepalive = false } = {}) {
  if (sending || !outbox.length) return sending;
  sending = (async () => {
    while (outbox.length) {
      const o = outbox[0];
      if (!canWriteAcct(o.acct)) break;
      const path = `/calendars/${encodeURIComponent(o.calId)}/events`;
      try {
        if (o.op === 'insert') {
          const ev = await api(o.acct, path, { method: 'POST', body: o.body, params: { fields: EVENT_FIELDS }, keepalive });
          const cal = calendars().find(c => c.acct === o.acct && c.id === o.calId);
          if (ev && cal) { const n = normalize(ev, cal, o.acct); if (n) putInCache(n); }
        } else if (o.op === 'patch') {
          const ev = await api(o.acct, `${path}/${encodeURIComponent(o.gid)}`, { method: 'PATCH', body: o.body, etag: o.etag, params: { fields: EVENT_FIELDS }, keepalive });
          const cal = calendars().find(c => c.acct === o.acct && c.id === o.calId);
          if (ev && cal) { const n = normalize(ev, cal, o.acct); if (n) putInCache(n); }
        } else if (o.op === 'delete') {
          await api(o.acct, `${path}/${encodeURIComponent(o.gid)}`, { method: 'DELETE', keepalive });
        }
        outbox.shift();
      } catch (err) {
        if (err instanceof Conflict) {
          outbox.shift();
          if (o.op === 'patch') notice('다른 곳에서 먼저 고친 일정이라 최신 내용으로 다시 불러왔어요');
          await refetchOne(o); // 새 일정이 이미 있으면(409) 그 일정을 그대로 쓴다
        } else if (err instanceof google.NeedLogin || err instanceof TypeError) {
          break; // 로그인·인터넷이 돌아오면 다시 보낸다
        } else {
          outbox.shift();
          notice(`구글 캘린더에 반영하지 못했어요: ${err.message}`);
          await refetchOne(o);
        }
      }
      await saveOutbox();
    }
    await saveCache();
    emit();
  })().finally(() => { sending = null; });
  return sending;
}

// ---- 담다에만 있던 일정을 구글로 옮기기 ----
/** 담다 일정 색 → 가장 가까운 구글 색 번호 */
export function nearestColorId(hex) {
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '';
  const [r, g, b] = rgb(hex);
  let best = '';
  let bestD = Infinity;
  for (const [id, c] of Object.entries(GOOGLE_COLORS)) {
    const [r2, g2, b2] = rgb(c);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

/** 담다 일정 아이디 → 항상 같은 구글 일정 아이디 (구글 규칙: 0~9, a~v) */
const migrateId = localId => 'damdal' + [...String(localId)].map(ch => ch.charCodeAt(0).toString(32).padStart(2, '0')).join('');

let migrating = false;
/** 담다에만 있는 일정을 구글 캘린더로 저절로 옮긴다 (쓸 수 있을 때만) */
async function autoMigrate() {
  if (migrating || !canWrite()) return;
  const local = store.list('events');
  if (!local.length) return;
  migrating = true;
  try {
    for (const e of local) {
      await createEvent({ title: e.title, start: e.start, end: e.end || e.start, time: e.time || '', colorId: nearestColorId(e.color), reminder: 'default' }, { gid: migrateId(e.id) });
    }
    store.batch(() => local.forEach(e => store.remove('events', e.id)));
    notice(`담다에만 있던 일정 ${local.length}개를 구글 캘린더로 옮겼어요`);
  } finally { migrating = false; }
}

// ---- 연결 · 계정 ----
/** 구글 계정을 처음 연결할 때 캘린더 권한도 함께 요청하도록 준비 */
export function prepareConnect() {
  for (const s of google.CAL_SCOPES) google.wantScope(s, true);
}

/** 연결이 끝난 뒤: 캘린더 권한을 받았으면 켠다. 반환값: 켰는지 */
export function afterConnect() {
  savePref(ON_KEY, true);
  refresh();
  return google.hasScope(google.CAL_READ);
}

/** 기본 계정에 캘린더 권한(보기+수정)을 받는다. 버튼을 누른 직후에 불러야 한다 */
export async function connectCalendar(hintEmail = '') {
  prepareConnect();
  await google.signIn(hintEmail);
  if (!google.hasScope(google.CAL_READ)) throw new Error('캘린더 권한이 체크되지 않았어요. 다시 연결하면서 체크해 주세요.');
  savePref(ON_KEY, true);
  await refresh();
  return {
    shown: calendars().filter(c => c.visible).length,
    canWrite: google.hasScope(google.CAL_WRITE),
  };
}

/** 다른 구글 계정의 캘린더 추가 (캘린더 권한만 받는다) */
export async function addAccount() {
  const t = await google.requestToken({ scopes: google.CAL_SCOPES, prompt: 'select_account' });
  if (!(t.scope || '').split(' ').includes(google.CAL_READ)) throw new Error('캘린더 권한이 체크되지 않았어요.');
  // 이 계정의 기본 캘린더 아이디 = 이메일
  const r = await fetch(`${API}/calendars/primary?fields=id`, { headers: { Authorization: `Bearer ${t.token}` } });
  const email = r.ok ? (await r.json()).id : '';
  if (!email) throw new Error('계정 정보를 읽지 못했어요.');
  if (email === mainEmail()) throw new Error('이미 기본 계정으로 연결된 계정이에요.');
  const x = extras();
  x[email] = t;
  savePref(EXTRA_KEY, x);
  await refresh();
  return email;
}

/** 추가 계정이 받을 권한: 캘린더 + (할 일·가계부 담는 곳이면) 드라이브 */
const scopesFor = email => [...google.CAL_SCOPES, ...(email === dataPlace() ? [google.DRIVE_SCOPE] : [])];

/** 추가 계정 다시 로그인 (만료됐을 때). 버튼을 누른 직후에 불러야 한다 */
export async function reloginAccount(email, { silent = false } = {}) {
  const t = await google.requestToken({ scopes: scopesFor(email), hint: email, silent });
  const x = extras();
  x[email] = t;
  savePref(EXTRA_KEY, x);
  await refresh({ force: false });
}

/** 할 일·가계부 담는 곳으로 쓰려고 그 계정의 드라이브 권한을 받는다. 반환: 그 계정에 담긴 기록이 있는지 */
export async function prepareDataPlace(email) {
  const t = await google.requestToken({ scopes: [...google.CAL_SCOPES, google.DRIVE_SCOPE], hint: email });
  if (!(t.scope || '').split(' ').includes(google.DRIVE_SCOPE)) throw new Error('드라이브 권한이 체크되지 않았어요. 다시 고르면서 체크해 주세요.');
  const x = extras();
  x[email] = t;
  savePref(EXTRA_KEY, x);
  return { token: t.token, hasRecords: !!(await findFile(t.token)) };
}

/** 지금 기록을 그 계정의 드라이브에 옮겨 담는다 ("가져가기") */
export async function copyRecordsTo(token) {
  await createDriveFile(store.exportData(), token);
}

export async function removeAccount(email) {
  const x = extras();
  try { if (x[email]?.token) window.google?.accounts?.oauth2?.revoke(x[email].token, () => {}); } catch {}
  google.forgetAccount(email, x[email]?.token);
  delete x[email];
  savePref(EXTRA_KEY, x);
  delete cache.accounts[email];
  outbox = outbox.filter(o => o.acct !== email);
  await saveOutbox();
  await saveCache();
  emit();
}

export async function disconnectCalendar() {
  for (const s of google.CAL_SCOPES) google.wantScope(s, false);
  for (const email of Object.keys(extras())) await removeAccount(email);
  savePref(ON_KEY, false);
  cache = { accounts: {} };
  outbox = [];
  status = { phase: 'off', message: '', lastFetch: 0, accounts: {} };
  await saveOutbox();
  await saveCache();
  emit();
}

// ---- 추가 계정 로그인 만료 → 다음 클릭에서 하나씩 다시 받기 ----
let armed = false;
function armRelogin() {
  if (armed || !isEnabled()) return;
  if (!accounts().some(a => !a.main && !tokenOf(a.key))) return;
  armed = true;
  // 앱(PC·갤럭시): 클릭을 기다리지 않고 창 없이 바로 다시 받는다 (안 되면 [다시 로그인]에 맡긴다)
  if (google.appLogin) {
    setTimeout(async () => {
      armed = false;
      for (const acc of accounts().filter(a => !a.main && !tokenOf(a.key))) { try { await reloginAccount(acc.email, { silent: true }); } catch {} }
    }, 0);
    return;
  }
  google.loadGis().catch(() => {});
  document.addEventListener('click', async e => {
    armed = false;
    if (e.target.closest?.('[data-act]')) return; // 버튼은 그 버튼이 처리한다
    const acc = accounts().find(a => !a.main && !tokenOf(a.key));
    if (!acc) return;
    try { await reloginAccount(acc.email); } catch {}
  }, { capture: true, once: true });
}

// ---- 할 일·가계부 담는 곳이 추가 계정이면, 드라이브는 그 계정 토큰으로 ----
if (dataPlace()) {
  const place = dataPlace();
  google.setDriveProvider({
    get: () => { const t = tokenOf(place); return t && (t.scope || '').split(' ').includes(google.DRIVE_SCOPE) ? t.token : null; },
    invalidate: () => { const x = extras(); if (x[place]) { x[place] = { ...x[place], exp: 0 }; savePref(EXTRA_KEY, x); } },
    relogin: opts => reloginAccount(place, opts),
  });
}

// ---- 시작 ----
// 이미 구글 계정이 연결된 기기: 다음 로그인 때 캘린더 권한도 함께 요청하도록 (직접 끈 경우 제외)
if (isEnabled()) prepareConnect();
(async () => {
  try {
    const saved = await getMeta(CACHE_KEY);
    if (saved?.accounts) cache = saved;
    const ob = await getMeta(OUTBOX_KEY);
    if (Array.isArray(ob)) outbox = ob;
    emit();
  } catch {}
  if (isEnabled()) refresh({ force: false });
})();
setInterval(() => { if (isEnabled() && document.visibilityState === 'visible') refresh({ force: true }); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // 화면을 떠나면 되돌리기를 기다리던 지우기를 바로 보낸다
    for (const id of [...pendingDeletes.keys()]) commitDelete(id, { keepalive: true });
  } else if (isEnabled()) refresh({ force: false });
});
window.addEventListener('online', () => { if (isEnabled()) refresh({ force: false }); });
window.addEventListener('ple:google-signin', () => { if (isEnabled()) setTimeout(() => refresh({ force: false }), 0); });
