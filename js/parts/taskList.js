// 할 일 부품.
// - 할 일 탭(full): 진행률 · 입력(반복 포함) · 필터 · 목록
// - 캘린더 날짜 패널(checklist): 체크만 하는 목록 + "할 일에서 열기"
// 카테고리 v2: 입력은 칩, 진행률 카드·필터 칩에는 그날 실제로 쓴 카테고리만.
import { store } from '../store.js';
import { removeWithUndo, toast } from '../ui/toast.js';
import { confirmDialog, choiceDialog } from '../ui/dialog.js';
import { categoriesOf, categoryById, categoryKey, UNCATEGORIZED, foldersOf, folderOfCategory } from '../categories.js';
import { chipPickerHtml, bindChipPicker, pickedCategory, bindCategoryLongPress } from './categoryUI.js';
import { tasksOn, setTaskDone, deleteOccurrence, endRuleFrom, saveTaskRule, streakOf, repeatLabel } from '../taskRepeat.js';
import { defaultRepeatState, repeatBoxHtml, bindRepeatBox, repeatFromState, openTaskRuleEditor } from './repeatUI.js';
import { escapeHtml, todayKey, loadPref, savePref, fullDateLabel } from '../utils.js';

const LAST_CAT_KEY = 'ple-last-category';
const filters = new Map();   // container.id → 'all' | 카테고리 id | 'none'
const repeats = new Map();   // container.id → 반복 옵션 상태 (켜져 있을 때만)
let refocusId = null;        // 추가 직후 입력창에 다시 포커스

/** 그날 쓴 카테고리만 (적어둔 순서). 미분류는 다른 카테고리와 섞여 있을 때만 따로 보여준다 */
function usedCategories(tasks) {
  const keys = new Set(tasks.map(t => categoryKey(t.category, 'task')));
  const cats = categoriesOf('task').filter(c => keys.has(c.id));
  return keys.has('none') && cats.length ? [...cats, UNCATEGORIZED] : cats;
}

export function categoryCardsHtml(tasks) {
  const cats = usedCategories(tasks);
  if (!cats.length) return '';
  return `<div class="cat-grid">${cats.map(c => {
    const k = c.id ?? 'none';
    const list = tasks.filter(t => categoryKey(t.category, 'task') === k);
    const done = list.filter(t => t.done).length;
    const pct = list.length ? (done / list.length) * 100 : 0;
    return `
      <div class="cat-card slot-${c.slot}"${c.id ? ` data-cat-id="${escapeHtml(c.id)}" data-cat-kind="task" title="길게 눌러 수정"` : ''}>
        <div class="cat-row"><span class="cat-name"><i class="swatch slot-${c.slot}"></i>${escapeHtml(c.name)}</span><span>${done}/${list.length}</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>`;
  }).join('')}</div>`;
}

export const progressOf = tasks => {
  const done = tasks.filter(t => t.done).length;
  return { done, total: tasks.length, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
};

// 반복 할 일은 '밀린 할 일'에 넣지 않는다 (매일 약이 쌓이면 안 되므로)
const overdueTasks = key => store.list('tasks', t => t.date < key && !t.done && !t.movedTo && !t.ruleId);

function taskRowHtml(t, { checklist }) {
  const c = categoryById(t.category, 'task');
  const rule = t.ruleId ? store.get('taskRules', t.ruleId) : null;
  const streak = rule ? streakOf(rule) : 0;
  return `
    <li class="task slot-${c.slot}${t.done ? ' done' : ''}" data-id="${escapeHtml(t.id)}">
      <label class="task-check">
        <input type="checkbox"${t.done ? ' checked' : ''} />
        <span class="task-main">
          <span class="task-title">${escapeHtml(t.title)}${t.label ? ` <span class="task-label">${escapeHtml(t.label)}</span>` : ''}</span>
          ${rule ? `<span class="task-meta">${repeatLabel(rule)}${streak > 1 ? ` · 🔥 ${streak}일 연속` : ''}</span>` : ''}
        </span>
      </label>
      ${t.movedTo ? '<span class="badge moved">옮김</span>' : ''}
      ${c.id ? `<span class="badge slot-${c.slot}" data-cat-id="${escapeHtml(c.id)}" data-cat-kind="task">${escapeHtml(c.name)}</span>` : ''}
      ${checklist ? '' : `
        ${rule ? `<button type="button" class="icon-btn small rep-btn" data-act="edit-rule" aria-label="반복 설정" title="반복 설정">⋯</button>` : ''}
        <button type="button" class="del-btn" data-act="delete" aria-label="삭제">✕</button>`}
    </li>`;
}

export function renderTasks(container, key, opts = {}) {
  container.dataset.key = key;
  container._opts = opts;
  if (!container.dataset.bound) { bind(container); container.dataset.bound = '1'; }

  const all = tasksOn(key).sort((a, b) => a.createdAt - b.createdAt);
  container._tasks = all;

  // ---- 캘린더 패널: 체크리스트만 ----
  if (opts.checklist) {
    container.innerHTML = all.length
      ? `<ul class="task-list checklist">${all.map(t => taskRowHtml(t, { checklist: true })).join('')}</ul>`
      : '<p class="empty">이날 할 일이 없어요.</p>';
    return;
  }

  const cats = usedCategories(all);
  // 폴더 필터: 그날 쓴 카테고리가 들어 있는 폴더만. 'f:폴더id'
  const folderOfTask = t => { const c = categoryById(t.category, 'task'); return c.id ? folderOfCategory(c) : null; };
  const usedFolders = foldersOf('task').filter(f => all.some(t => folderOfTask(t) === f.id));
  const matches = (t, k) => (k.startsWith('f:') ? folderOfTask(t) === k.slice(2) : categoryKey(t.category, 'task') === k);
  let filter = filters.get(container.id) || 'all';
  if (filter !== 'all' && !cats.some(c => (c.id ?? 'none') === filter) && !usedFolders.some(f => `f:${f.id}` === filter)) filter = 'all';
  const shown = filter === 'all' ? all : all.filter(t => matches(t, filter));
  const rep = repeats.get(container.id);

  let html = '';
  if (opts.full) {
    const p = progressOf(all);
    html += `
      <div class="summary">
        <div class="summary-top">
          <div>
            <div class="muted">전체 진행률</div>
            <div class="big">${p.done}/${p.total} 완료 (${p.pct}%)</div>
          </div>
          <div class="summary-right">
            <div class="muted">남은 할 일</div>
            <div class="big accent">${p.total - p.done}개</div>
          </div>
        </div>
        <div class="bar"><i style="width:${p.pct}%"></i></div>
        ${categoryCardsHtml(all)}
      </div>`;

    if (key === todayKey()) {
      const overdue = overdueTasks(key);
      if (overdue.length) {
        html += `<button type="button" class="overdue-btn" data-act="overdue">⏰ 밀린 할 일 ${overdue.length}개 → 오늘로 가져오기</button>`;
      }
    }
  }

  html += `
    <form class="task-form">
      ${chipPickerHtml('task', loadPref(LAST_CAT_KEY, null))}
      <div class="input-row">
        <input class="task-input" type="text" maxlength="100" placeholder="${rep ? '반복할 일 (예: 약 먹기)' : '새로운 할 일 (Alt+N)'}" required />
        <button type="button" class="repeat-toggle${rep ? ' on' : ''}" data-act="repeat-toggle" aria-pressed="${!!rep}" title="반복">반복</button>
        <button class="primary-btn">추가</button>
      </div>
      ${rep ? `<div class="repeat-box">${repeatBoxHtml(rep)}</div>` : ''}
      <p class="form-error" hidden></p>
    </form>`;

  if (opts.full && all.length) {
    const count = k => (k === 'all' ? all.length : all.filter(t => matches(t, k)).length);
    const doneCount = all.filter(t => t.done).length;
    html += `
      <div class="filter-bar">
        <div class="chip-row">
          ${cats.length ? `
            <button type="button" class="chip${filter === 'all' ? ' active' : ''}" data-filter="all">전체 <span class="chip-count">${count('all')}</span></button>
            ${usedFolders.map(f => `
              <button type="button" class="chip folder-chip${filter === `f:${f.id}` ? ' active' : ''}" data-filter="f:${escapeHtml(f.id)}"><span class="group-dots" aria-hidden="true">${categoriesOf('task').filter(c => folderOfCategory(c) === f.id).slice(0, 4).map(c => `<i class="slot-${c.slot}"></i>`).join('')}</span>${escapeHtml(f.name)} <span class="chip-count">${count(`f:${f.id}`)}</span></button>`).join('')}
            ${cats.map(c => {
              const k = c.id ?? 'none';
              return `
                <button type="button" class="chip${filter === k ? ' active' : ''}" data-filter="${escapeHtml(k)}"${c.id ? ` data-cat-id="${escapeHtml(c.id)}" data-cat-kind="task"` : ''}>
                  <i class="swatch slot-${c.slot}"></i>${escapeHtml(c.name)} <span class="chip-count">${count(k)}</span>
                </button>`;
            }).join('')}` : ''}
        </div>
        <button type="button" class="chip danger" data-act="clear-done"${doneCount ? '' : ' disabled'}>🗑 완료 항목 삭제</button>
      </div>`;
  }

  html += shown.length
    ? `<ul class="task-list">${shown.map(t => taskRowHtml(t, { checklist: false })).join('')}</ul>`
    : `<p class="empty">${all.length ? '이 카테고리에는 할 일이 없어요.' : '아직 할 일이 없어요. 위에서 추가해보세요.'}</p>`;

  container.innerHTML = html;
  if (refocusId === container.id) {
    container.querySelector('.task-input')?.focus();
    refocusId = null;
  }
}

function bind(container) {
  const rerender = () => renderTasks(container, container.dataset.key, container._opts);
  const findTask = el => container._tasks?.find(t => t.id === el.closest('.task')?.dataset.id);
  bindCategoryLongPress(container);
  bindChipPicker(container, id => savePref(LAST_CAT_KEY, id));
  bindRepeatBox(container, () => repeats.get(container.id));

  container.addEventListener('submit', e => {
    if (!e.target.matches('.task-form')) return;
    e.preventDefault();
    const title = e.target.querySelector('.task-input').value.trim();
    if (!title) return;
    const key = container.dataset.key;
    const category = pickedCategory(e.target);
    const rep = repeats.get(container.id);
    refocusId = container.id;
    if (!rep) {
      store.put('tasks', { date: key, title, category, done: false });
      return;
    }
    try {
      saveTaskRule({ title, category, startDate: key, ...repeatFromState(rep) });
      repeats.delete(container.id);
      rerender();
      toast(`'${title}' 반복 할 일을 만들었어요`);
    } catch (err) {
      const p = e.target.querySelector('.form-error');
      p.textContent = err.message;
      p.hidden = false;
    }
  });

  container.addEventListener('change', e => {
    if (!e.target.matches('.task-check input')) return;
    const t = findTask(e.target);
    if (t) setTaskDone(t, e.target.checked);
  });

  container.addEventListener('click', async e => {
    const chip = e.target.closest('[data-filter]');
    if (chip) { filters.set(container.id, chip.dataset.filter); return rerender(); }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'repeat-toggle') {
      if (repeats.has(container.id)) repeats.delete(container.id);
      else repeats.set(container.id, defaultRepeatState(container.dataset.key));
      const typed = container.querySelector('.task-input')?.value || '';
      rerender();
      const input = container.querySelector('.task-input');
      input.value = typed;
      input.focus();
    } else if (act === 'edit-rule') {
      const t = findTask(e.target);
      if (t?.ruleId) openTaskRuleEditor(t.ruleId, t.date);
    } else if (act === 'delete') {
      const t = findTask(e.target);
      if (!t) return;
      if (!t.ruleId) return removeWithUndo('tasks', t.id, '할 일을 삭제했어요');
      const choice = await choiceDialog({
        title: `'${t.title}' 삭제`,
        message: '반복하는 할 일이에요. 어떻게 지울까요?',
        choices: [
          { label: '이 날만', value: 'one' },
          { label: '이 날부터 앞으로 전부', value: 'all', danger: true },
        ],
      });
      if (choice === 'one') {
        deleteOccurrence(t);
        toast(`${fullDateLabel(t.date)}의 '${t.title}'만 지웠어요`, {
          label: '되돌리기', run: () => store.restore('tasks', t.id),
        });
      } else if (choice === 'all') {
        endRuleFrom(t.ruleId, t.date);
        toast(`'${t.title}' 반복을 그만했어요`);
      }
    } else if (act === 'clear-done') {
      const done = (container._tasks || []).filter(t => t.done);
      if (!done.length) return;
      const ok = await confirmDialog({ title: '완료 항목 삭제', message: `완료된 할 일 ${done.length}개를 삭제할까요?`, okLabel: '삭제', danger: true });
      if (ok) removeWithUndo('tasks', done.map(t => t.id), `완료된 할 일 ${done.length}개를 삭제했어요`);
    } else if (act === 'overdue') {
      const key = container.dataset.key;
      const overdue = overdueTasks(key);
      store.batch(() => overdue.forEach(t => {
        store.put('tasks', { date: key, title: t.title, category: t.category ?? null, done: false, fromId: t.id });
        store.put('tasks', { id: t.id, movedTo: key });
      }));
      toast(`밀린 할 일 ${overdue.length}개를 오늘로 가져왔어요`);
    }
  });
}

/** Alt+N: 보이는 할 일 입력창으로 이동 */
export function focusTaskInput(root) {
  const input = root.querySelector('.task-input');
  if (input) { input.focus(); return true; }
  return false;
}
