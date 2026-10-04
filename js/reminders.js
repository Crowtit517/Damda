// 알림 예약 (10-05 결정).
// - 갤럭시 앱: 폰 알람에 직접 예약 → 앱을 꺼도, 인터넷이 없어도, 폰을 껐다 켜도 울린다. 소리는 폰 기본 알림음
// - PC 앱: 담다가 켜져 있는 동안 소리 없는 Windows 알림
// - 웹: 알림 없음 (기록만 해 두면 폰 앱이 울린다)
// 알리는 것: 알림 시간을 정한 할 일·반복 할 일, 담다에만 있는 일정(시간·알림 설정).
// 구글 캘린더에 들어간 일정은 폰의 캘린더 앱이 이미 알려 주므로 담다는 알리지 않는다 (두 번 울리지 않게).
import { store } from './store.js';
import { getSetting } from './settings.js';
import { todayKey, addDays, keyToDate } from './utils.js';
import { occursOn, occurrenceTaskId } from './taskRepeat.js';
import { isNative, plugin } from './native.js';
import { isDesk } from './desk.js';

const DAYS_AHEAD = 7;   // 앞으로 7일치를 예약 (열 때마다 다시 맞춘다)
const MAX = 60;         // 한 번에 예약하는 개수 (안드로이드 알람 개수 제한 안에서)
const CHANNEL = 'damda';
const ALLDAY_DEFAULT = 9 * 60; // 종일 일정의 '기본 알림' = 그날 오전 9시

const at = (key, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = keyToDate(key); d.setHours(h, m, 0, 0); return d; };
const hhmm = d => `${d.getHours() < 12 ? '오전' : '오후'} ${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}`;
// 같은 알림은 늘 같은 번호 (다시 맞출 때 겹치지 않게)
const idOf = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 2000000000 + 1; };

/** 앞으로 울릴 알림 목록 [{ id, at: Date, title, body }] */
export function upcoming(now = new Date()) {
  const out = [];
  const start = todayKey();
  const days = Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => addDays(start, i));

  // 하루짜리 할 일
  for (const t of store.list('tasks', t => t.alarm && !t.done && !t.movedTo)) {
    out.push({ key: `t:${t.id}`, at: at(t.date, t.alarm), title: t.title, body: `할 일 · ${hhmm(at(t.date, t.alarm))}` });
  }
  // 반복 할 일: 회차마다 알림 시간 (아침 9시 약 먹기 등). 이미 체크했거나 그날만 지운 회차는 빼고
  for (const r of store.list('taskRules', r => (r.alarms || []).some(Boolean) && !r.paused)) {
    for (const key of days) {
      if (!occursOn(r, key)) continue;
      (r.alarms || []).forEach((a, slot) => {
        if (!a) return;
        const done = store.peek('tasks', occurrenceTaskId(r, key, slot));
        if (done && (done.done || done.deleted)) return;
        const name = r.times?.[slot];
        out.push({ key: `r:${r.id}:${key}:${slot}`, at: at(key, a), title: name ? `${r.title} (${name})` : r.title, body: `반복 할 일 · ${hhmm(at(key, a))}` });
      });
    }
  }
  // 담다에만 있는 일정 (구글 캘린더 일정은 store에 없다 → 캘린더 앱이 알린다)
  for (const e of store.list('events', e => e.start >= start && e.start <= days[days.length - 1] && e.reminder !== 'none')) {
    let when;
    if (e.time) when = new Date(at(e.start, e.time).getTime() - (e.reminder === 'default' || !e.reminder ? 10 : Number(e.reminder)) * 60000);
    else {
      // 종일 일정: 구글과 같은 뜻 = 그날 0시보다 몇 분 전 (900 = 전날 오전 9시, 360 = 전날 오후 6시). 기본은 그날 오전 9시
      when = e.reminder === 'default' || !e.reminder
        ? new Date(at(e.start, '00:00').getTime() + ALLDAY_DEFAULT * 60000)
        : new Date(at(e.start, '00:00').getTime() - Number(e.reminder) * 60000);
    }
    out.push({ key: `e:${e.id}`, at: when, title: e.title, body: e.time ? `일정 · ${hhmm(at(e.start, e.time))}` : '오늘 일정 (종일)' });
  }
  return out
    .filter(n => n.at > now && !Number.isNaN(n.at.getTime()))
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX)
    .map(n => ({ ...n, id: idOf(n.key) }));
}

// ---- 갤럭시 앱: 폰 알람에 예약 ----
let channelReady = false;
let asked = false;
async function scheduleNative(list) {
  const LN = plugin('LocalNotifications');
  if (!LN) return;
  const pending = (await LN.getPending().catch(() => ({ notifications: [] }))).notifications || [];
  if (pending.length) await LN.cancel({ notifications: pending.map(n => ({ id: n.id })) }).catch(() => {});
  if (!list.length) return;
  let perm = (await LN.checkPermissions().catch(() => ({}))).display;
  if (perm === 'prompt' && !asked) { asked = true; perm = (await LN.requestPermissions().catch(() => ({}))).display; }
  if (perm !== 'granted') return;
  if (!channelReady) {
    await LN.createChannel({ id: CHANNEL, name: '담다 알림', description: '할 일·일정 알림', importance: 4, visibility: 1, vibration: true }).catch(() => {});
    channelReady = true;
  }
  await LN.schedule({
    notifications: list.map(n => ({ id: n.id, title: n.title, body: n.body, channelId: CHANNEL, smallIcon: 'ic_stat_damda', schedule: { at: n.at, allowWhileIdle: true } })),
  }).catch(() => {});
}

// ---- PC 앱: 켜져 있는 동안 소리 없는 알림 ----
let timers = [];
function scheduleDesk(list) {
  timers.forEach(clearTimeout);
  timers = list.filter(n => n.at - Date.now() < 24 * 3600000)
    .map(n => setTimeout(() => window.desk.notify(n.title, n.body), n.at - Date.now()));
}

let queued = null;
export function rescheduleSoon() {
  if (!isNative && !isDesk) return;
  clearTimeout(queued);
  queued = setTimeout(() => {
    const list = getSetting('notify') ? upcoming() : [];
    if (isNative) scheduleNative(list);
    else scheduleDesk(list);
  }, 1500);
}

/** 앱(갤럭시·PC)에서만: 기록이 바뀌거나, 설정을 바꾸거나, 앱으로 돌아올 때 다시 맞춘다 */
export function startReminders() {
  if (!isNative && !isDesk) return;
  store.subscribe(rescheduleSoon);
  window.addEventListener('ple:settingchange', rescheduleSoon);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) rescheduleSoon(); });
  setInterval(rescheduleSoon, 3 * 3600000); // 날이 바뀌어도 7일치가 이어지게
  rescheduleSoon();
}
