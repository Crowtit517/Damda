// 일정 고치기 창. 구글 일정은 구글 캘린더에, 담다 일정은 담다에 저장한다.
import { store } from '../store.js';
import { openOverlay, closeOverlay, closeOnBackdrop } from '../ui/overlay.js';
import { toast, removeWithUndo } from '../ui/toast.js';
import * as gcal from '../sync/gcal.js';
import { eventFormHtml, bindEventForm, readEventForm } from './eventForm.js';
import { escapeHtml, isValidKey, safeColor } from '../utils.js';

const el = document.getElementById('eventModal');
closeOnBackdrop(el);
let editing = null;

export function openEventEditor(ev) {
  editing = ev;
  const google = ev.source === 'google';
  const cal = google ? gcal.calendars().find(c => c.acct === ev.acct && c.id === ev.calId) : null;
  el.innerHTML = `
    <div class="modal-box wide">
      <div class="modal-head">
        <strong>일정 고치기</strong>
        <button type="button" class="icon-btn close-btn" data-close aria-label="닫기">✕</button>
      </div>
      <form class="event-form">
        ${eventFormHtml({
          ev, dayKey: ev.start, google, calColor: cal?.color,
          note: google ? `구글 캘린더 · ${escapeHtml(ev.calName)}${cal?.accountEmail && cal.accountEmail !== ev.calName ? ` (${escapeHtml(cal.accountEmail)})` : ''}에 저장돼요` : '담다에만 저장된 일정이에요',
          submitLabel: '저장',
        })}
      </form>
      <div class="modal-actions">
        ${google && ev.link ? `<a class="pill-btn" href="${escapeHtml(ev.link)}" target="_blank" rel="noopener noreferrer">구글 캘린더에서 열기</a>` : ''}
        <button type="button" class="pill-btn danger-text" data-act="delete">지우기</button>
      </div>
    </div>`;
  bindEventForm(el.querySelector('.event-form'));
  openOverlay({ el, layer: 2, onClose: () => { editing = null; } });
}

el.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) return closeOverlay(el);
  if (!e.target.closest('[data-act="delete"]') || !editing) return;
  const ev = editing;
  closeOverlay(el);
  if (ev.source === 'google') {
    try {
      const undo = gcal.deleteEvent(ev);
      toast('일정을 지웠어요', { label: '되돌리기', run: undo }, 8000);
    } catch (err) { toast(err.message); }
  } else {
    removeWithUndo('events', ev.id, '일정을 지웠어요');
  }
});

el.addEventListener('submit', async e => {
  e.preventDefault();
  if (!editing) return;
  const input = readEventForm(e.target);
  if (!input.title || !isValidKey(input.start)) return;
  const ev = editing;
  closeOverlay(el);
  try {
    if (ev.source === 'google') {
      await gcal.updateEvent(ev, input);
      toast('구글 캘린더 일정을 고쳤어요');
    } else {
      store.put('events', { id: ev.id, title: input.title, start: input.start, end: input.end, time: input.time, color: safeColor(input.color) });
    }
  } catch (err) { toast(err.message); }
});
