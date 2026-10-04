// 일정 입력 칸 (날짜 패널의 "일정 추가"와 일정 고치기 창이 같이 쓴다).
// 구글 캘린더에 저장하는 일정은 끝 시간·알림·구글 색을, 담다에만 저장하는 일정은 예전 색을 고른다.
import { EVENT_COLORS, escapeHtml } from '../utils.js';
import { GOOGLE_COLORS } from '../sync/gcal.js';

const REMINDERS_TIMED = [['default', '기본 알림'], ['none', '알림 없음'], ['10', '10분 전'], ['30', '30분 전'], ['60', '1시간 전'], ['1440', '하루 전']];
const REMINDERS_ALLDAY = [['default', '기본 알림'], ['none', '알림 없음'], ['900', '전날 오전 9시'], ['360', '전날 오후 6시']];
const PICK_GOOGLE = [['', '캘린더 색'], ['7', '파랑'], ['2', '초록'], ['5', '노랑'], ['6', '주황'], ['11', '빨강'], ['3', '보라'], ['8', '회색']];

const reminderOptions = (timed, selected) => {
  const list = timed ? REMINDERS_TIMED : REMINDERS_ALLDAY;
  const sel = list.some(([v]) => v === selected) ? selected : 'default';
  return list.map(([v, label]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${label}</option>`).join('');
};

/**
 * ev: 고칠 일정(없으면 새 일정), dayKey: 새 일정의 날짜, google: 구글 캘린더에 저장하나,
 * calColor: 구글 "캘린더 색" 미리보기, note: 저장 위치 안내 문장
 */
export function eventFormHtml({ ev = null, dayKey, google = false, calColor = '#4285f4', note = '', submitLabel = '담아두기' }) {
  const start = ev?.start || dayKey;
  const colorPicker = google
    ? PICK_GOOGLE.map(([id, label]) => `
        <label class="color-swatch" style="--sw:${id ? GOOGLE_COLORS[id] : calColor}" title="${label}">
          <input type="radio" name="colorId" value="${id}"${(ev?.colorId || '') === id ? ' checked' : ''} aria-label="${label}" />
        </label>`).join('')
    : EVENT_COLORS.map((c, i) => `
        <label class="color-swatch" style="--sw:${c.hex}" title="${c.label}">
          <input type="radio" name="color" value="${c.hex}"${(ev ? ev.color === c.hex : i === 0) ? ' checked' : ''} aria-label="${c.label}" />
        </label>`).join('');
  return `
    <input name="title" type="text" maxlength="80" placeholder="무슨 일이 있나요?" value="${escapeHtml(ev?.title || '')}" required />
    <div class="form-row">
      <label>시작 <input name="start" type="date" value="${start}" required /></label>
      <label>종료 <input name="end" type="date" value="${ev?.end || start}" required /></label>
    </div>
    <div class="form-row">
      <label>시간 <input name="time" type="time" value="${ev?.time || ''}" /></label>
      ${google ? `<label class="end-time"${ev?.time ? '' : ' hidden'}>끝 <input name="endTime" type="time" value="${ev?.time ? ev.endTime || '' : ''}" /></label>` : ''}
      <span class="muted small all-day-note"${ev?.time ? ' hidden' : ''}>비우면 종일</span>
    </div>
    ${google ? `
      <label class="form-line">알림
        <select name="reminder">${reminderOptions(!!ev?.time, ev?.reminder || 'default')}</select>
      </label>` : ''}
    <div class="color-row" role="radiogroup" aria-label="색상">${colorPicker}</div>
    ${note ? `<p class="muted small event-note">${note}</p>` : ''}
    <button class="primary-btn wide">${submitLabel}</button>`;
}

/** 시간을 넣고 빼면 끝 시간 칸과 알림 목록을 바꾼다 */
export function bindEventForm(form) {
  form.addEventListener('input', e => {
    if (e.target.name !== 'time') return;
    const timed = !!e.target.value;
    const end = form.querySelector('.end-time');
    if (end) end.hidden = !timed;
    const note = form.querySelector('.all-day-note');
    if (note) note.hidden = timed;
    const sel = form.querySelector('select[name="reminder"]');
    if (sel) sel.innerHTML = reminderOptions(timed, sel.value);
  });
}

export function readEventForm(form) {
  const f = new FormData(form);
  const start = String(f.get('start') || '');
  let end = String(f.get('end') || '') || start;
  if (end < start) end = start;
  return {
    title: String(f.get('title') || '').trim(),
    start, end,
    time: String(f.get('time') || ''),
    endTime: String(f.get('endTime') || ''),
    colorId: String(f.get('colorId') || ''),
    color: String(f.get('color') || ''),
    reminder: String(f.get('reminder') || 'default'),
  };
}
