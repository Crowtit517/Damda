// 반복 할 일 화면: 반복 옵션 상자(입력 폼·수정 창 공용), 반복 할 일 수정 창.
import { store } from '../store.js';
import { openOverlay, closeOverlay, closeOnBackdrop, isOpen } from '../ui/overlay.js';
import { choiceDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { REPEAT_TYPES, DEFAULT_TIMES, saveTaskRule, endRuleFrom, repeatLabel } from '../taskRepeat.js';
import { chipPickerHtml, bindChipPicker, pickedCategory } from './categoryUI.js';
import { escapeHtml, keyToDate, DOW_NAMES, fullDateLabel } from '../utils.js';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월요일부터

// "10월 3일 ~ 10월 9일 · 7일" (해가 바뀌면 연도도)
function rangeText(a, b) {
  const da = keyToDate(a), db = keyToDate(b);
  const f = (d, withYear) => `${withYear ? `${d.getFullYear()}년 ` : ''}${d.getMonth() + 1}월 ${d.getDate()}일`;
  const days = Math.round((db - da) / 86400000) + 1;
  return `📅 ${f(da, false)} ~ ${f(db, da.getFullYear() !== db.getFullYear())} · ${days}일`;
}

export function defaultRepeatState(key) {
  const d = keyToDate(key);
  return { type: 'daily', days: [d.getDay()], day: String(d.getDate()), times: [''], alarms: [], endMode: 'none', startDate: key, endDate: '' };
}

export function stateFromRule(rule) {
  const r = rule.repeat || { type: 'daily' };
  return {
    type: r.type, days: r.days || [], day: String(r.day || '1'),
    times: rule.times?.length ? [...rule.times] : [''],
    alarms: [...(rule.alarms || [])],
    endMode: rule.endDate ? 'date' : 'none', startDate: rule.startDate, endDate: rule.endDate || '',
  };
}

/** 저장할 규칙 모양으로 */
export function repeatFromState(s) {
  const repeat = { type: s.type };
  if (s.type === 'weekly') repeat.days = [...s.days];
  if (s.type === 'monthly') repeat.day = s.day;
  if (s.endMode === 'date' && !s.endDate) throw new Error('언제까지 할지 끝나는 날을 골라주세요.');
  // 알림 시간: 회차마다 (비우면 알림 없음). 울리는 건 갤럭시 담다 앱 (js/reminders.js)
  const alarms = s.times.map((_, i) => s.alarms?.[i] || '');
  return { repeat, times: s.times, alarms: alarms.some(Boolean) ? alarms : [], startDate: s.startDate, endDate: s.endMode === 'date' ? s.endDate : null };
}

export function repeatBoxHtml(s) {
  const count = s.times.length;
  return `
    <div class="repeat-row" role="radiogroup" aria-label="반복">
      ${REPEAT_TYPES.map(t => `<button type="button" class="seg-chip${s.type === t.key ? ' on' : ''}" data-rtype="${t.key}" aria-pressed="${s.type === t.key}">${t.label}</button>`).join('')}
    </div>
    ${s.type === 'weekly' ? `
      <div class="repeat-row week" role="group" aria-label="요일">
        ${WEEK_ORDER.map(i => `<button type="button" class="dow-chip${s.days.includes(i) ? ' on' : ''}${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}" data-rdow="${i}" aria-pressed="${s.days.includes(i)}">${DOW_NAMES[i]}</button>`).join('')}
      </div>` : ''}
    ${s.type === 'monthly' ? `
      <div class="repeat-row"><span class="muted small">매월</span>
        <select class="r-month-day" aria-label="날짜">
          ${Array.from({ length: 31 }, (_, i) => String(i + 1)).map(d => `<option value="${d}"${s.day === d ? ' selected' : ''}>${d}일</option>`).join('')}
          <option value="last"${s.day === 'last' ? ' selected' : ''}>말일</option>
        </select>
      </div>` : ''}
    <div class="repeat-label">하루에</div>
    <div class="repeat-row">
      ${[1, 2, 3].map(n => `<button type="button" class="seg-chip${count === n ? ' on' : ''}" data-rcount="${n}" aria-pressed="${count === n}">${n}번</button>`).join('')}
    </div>
    ${count > 1 ? `
      <div class="repeat-row times">
        ${s.times.map((t, i) => `<input class="r-time" data-i="${i}" type="text" maxlength="8" value="${escapeHtml(t)}" placeholder="${i + 1}번째" aria-label="${i + 1}번째 이름" />`).join('')}
      </div>` : ''}
    <div class="repeat-label">알림 <span class="muted small">(선택 · 폰 담다 앱에서 울려요)</span></div>
    <div class="repeat-row alarms">
      ${s.times.map((t, i) => `<label class="r-alarm-field">${count > 1 ? `<span>${escapeHtml(t || `${i + 1}번째`)}</span>` : '<span aria-hidden="true">⏰</span>'}<input class="r-alarm" data-i="${i}" type="time" value="${escapeHtml(s.alarms?.[i] || '')}" aria-label="${escapeHtml(t || `${i + 1}번째`)} 알림 시간" /></label>`).join('')}
    </div>
    <div class="repeat-label">기간</div>
    <div class="repeat-row">
      <button type="button" class="seg-chip${s.endMode === 'none' ? ' on' : ''}" data-rend="none" aria-pressed="${s.endMode === 'none'}">반복</button>
      <button type="button" class="seg-chip${s.endMode === 'date' ? ' on' : ''}" data-rend="date" aria-pressed="${s.endMode === 'date'}">기한</button>
    </div>
    ${s.endMode === 'date' ? `
      <div class="repeat-row range">
        <label class="range-field"><span>시작</span><input class="r-start" type="date" value="${escapeHtml(s.startDate)}" aria-label="시작하는 날" /></label>
        <span class="range-tilde" aria-hidden="true">~</span>
        <label class="range-field"><span>끝</span><input class="r-end" type="date" value="${escapeHtml(s.endDate)}" min="${escapeHtml(s.startDate)}" aria-label="끝나는 날" /></label>
      </div>
      ${s.startDate && s.endDate && s.endDate >= s.startDate ? `<div class="range-summary">${rangeText(s.startDate, s.endDate)}</div>` : ''}` : ''}`;
}

/** root 안의 .repeat-box 조작을 연결. getState(box) → 상태 객체 (직접 바꾼다) */
export function bindRepeatBox(root, getState) {
  const redraw = box => { box.innerHTML = repeatBoxHtml(getState(box)); };
  root.addEventListener('click', e => {
    const box = e.target.closest('.repeat-box');
    if (!box || !root.contains(box)) return;
    const s = getState(box);
    if (!s) return;
    const t = e.target.closest('[data-rtype],[data-rdow],[data-rcount],[data-rend]');
    if (!t) return;
    if (t.dataset.rtype) s.type = t.dataset.rtype;
    if (t.dataset.rdow) {
      const i = Number(t.dataset.rdow);
      s.days = s.days.includes(i) ? s.days.filter(x => x !== i) : [...s.days, i];
    }
    if (t.dataset.rcount) {
      const n = Number(t.dataset.rcount);
      // 기본 이름(아침·점심·저녁)은 횟수에 맞게 새로 채우고, 사용자가 직접 바꾼 이름만 그 자리에 남긴다
      const isDefault = v => !v || Object.values(DEFAULT_TIMES).flat().includes(v);
      s.times = n === s.times.length ? s.times : DEFAULT_TIMES[n].map((d, i) => (isDefault(s.times[i]) ? d : s.times[i]));
      s.alarms = (s.alarms || []).slice(0, n);
    }
    if (t.dataset.rend) s.endMode = t.dataset.rend;
    redraw(box);
  });
  root.addEventListener('input', e => {
    const box = e.target.closest('.repeat-box');
    const s = box && getState(box);
    if (!s) return;
    if (e.target.matches('.r-time')) s.times[Number(e.target.dataset.i)] = e.target.value;
    if (e.target.matches('.r-alarm')) (s.alarms ||= [])[Number(e.target.dataset.i)] = e.target.value;
  });
  root.addEventListener('change', e => {
    const box = e.target.closest('.repeat-box');
    const s = box && getState(box);
    if (!s) return;
    if (e.target.matches('.r-month-day')) s.day = e.target.value;
    if (e.target.matches('.r-start, .r-end')) {
      if (e.target.matches('.r-start') && e.target.value) s.startDate = e.target.value;
      if (e.target.matches('.r-end')) s.endDate = e.target.value;
      if (s.endDate && s.endDate < s.startDate) s.endDate = s.startDate; // 끝이 시작보다 빠르면 맞춰준다
      redraw(box);
    }
  });
}

// ---- 반복 할 일 수정 창 ----
const modal = document.getElementById('taskRuleModal');
closeOnBackdrop(modal);
let editing = null; // { id, fromKey, state }

export function openTaskRuleEditor(ruleId, fromKey) {
  const rule = store.get('taskRules', ruleId);
  if (!rule) return;
  editing = { id: ruleId, fromKey, state: stateFromRule(rule) };
  modal.innerHTML = `
    <div class="modal-box wide">
      <div class="modal-head">
        <strong>반복 할 일</strong>
        <button type="button" class="icon-btn close-btn" data-close aria-label="닫기">✕</button>
      </div>
      <form class="task-rule-form">
        <input name="title" class="rule-title" type="text" maxlength="100" value="${escapeHtml(rule.title)}" required aria-label="할 일 이름" />
        ${chipPickerHtml('task', rule.category ?? null)}
        <div class="repeat-box">${repeatBoxHtml(editing.state)}</div>
        <p class="muted small rule-note">${rule.endDate ? '' : `${fullDateLabel(rule.startDate)}부터 · `}바꾸면 아직 체크하지 않은 날에 적용돼요.</p>
        <p class="form-error" hidden></p>
        <div class="modal-actions">
          <button type="button" class="pill-btn danger-text" data-act="end-rule">이 날부터 그만하기</button>
          <button class="primary-btn">저장</button>
        </div>
      </form>
    </div>`;
  if (!isOpen(modal)) openOverlay({ el: modal, layer: 2, onClose: () => { editing = null; } });
}

bindRepeatBox(modal, () => editing?.state);
bindChipPicker(modal, () => {});

modal.addEventListener('click', async e => {
  if (e.target.closest('[data-close]')) return closeOverlay(modal);
  if (e.target.closest('[data-act="end-rule"]') && editing) {
    const rule = store.get('taskRules', editing.id);
    const choice = await choiceDialog({
      title: `'${rule.title}' 그만하기`,
      message: `${fullDateLabel(editing.fromKey)}부터 더 이상 나타나지 않아요. 그 전에 체크한 기록은 그대로 남아요.`,
      choices: [{ label: '그만하기', value: 'end', danger: true }],
    });
    if (choice !== 'end' || !editing) return;
    endRuleFrom(editing.id, editing.fromKey);
    closeOverlay(modal);
    toast(`'${rule.title}' 반복을 그만했어요`);
  }
});

modal.addEventListener('submit', e => {
  if (!e.target.matches('.task-rule-form') || !editing) return;
  e.preventDefault();
  const f = e.target;
  try {
    saveTaskRule({ id: editing.id, title: f.title.value, category: pickedCategory(f), ...repeatFromState(editing.state) });
    closeOverlay(modal);
    toast('반복 할 일을 고쳤어요');
  } catch (err) {
    const p = f.querySelector('.form-error');
    p.textContent = err.message;
    p.hidden = false;
  }
});

export { repeatLabel };
