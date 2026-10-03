// 카테고리 화면 (홈 화면 방식). 정리하는 창을 따로 두지 않고, 쓰는 자리에서 그대로 정리한다.
// - 칩 줄: 묶음은 칩 하나로 접혀 있고(안에 든 색 점 미리보기), 누르면 그 자리에서 펼친다. 최대 2줄, 넘치면 [＋N].
// - 서랍: [＋N]·[＋ 추가]를 누르면 아래에서 올라오는 공간. 묶음별로 모두 보이고 스크롤된다 (많으면 검색칸).
// - 정리 모드: 칩을 꾹 누르거나 서랍의 [정리하기]. 칩을 다른 칩 위에 겹치면 묶음이 생기고, 밖으로 끌면 꺼내진다.
//   빈 묶음은 저절로 사라진다. 칩을 누르면 이름·색 고치기, ×로 삭제 (되돌리기 있음).
import { store } from '../store.js';
import { buzz } from '../settings.js';
import { openOverlay, closeOverlay, closeOnBackdrop, isOpen } from '../ui/overlay.js';
import { toast } from '../ui/toast.js';
import {
  categoriesOf, addCategory, updateCategory, deleteCategory, restoreCategory, usageCount,
  foldersOf, folderOfCategory, updateFolder, deleteFolder, restoreFolder, arrangeCategories,
  moveCategoryTo, createGroupFrom, cleanupEmptyFolders, newCategoryId, KIND_LABEL, MAX_NAME,
} from '../categories.js';
import { escapeHtml, josa } from '../utils.js';

const drawer = document.getElementById('categoryModal');
drawer.classList.add('drawer-wrap');
closeOnBackdrop(drawer);

const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const slotTitle = s => (s ? `색 ${s}` : '색 없음');
const SUGGEST = {
  task: ['건강', '회사', '공부', '생활', '취미', '집안일'],
  ledger: ['고정비', '생활비', '식비', '수입', '저축', '여가'],
};
const ADD_HINT = { task: '예: 운동', ledger: '예: 식비' };

// 묶음 칩 앞의 작은 색 점 (최대 4개, 2×2)
const dotsHtml = cats => `<span class="group-dots" aria-hidden="true">${cats.slice(0, 4).map(c => `<i class="slot-${c.slot}"></i>`).join('')}</span>`;
const groupsOf = kind => {
  const cats = categoriesOf(kind);
  return {
    cats,
    groups: foldersOf(kind).map(f => ({ f, cats: cats.filter(c => folderOfCategory(c) === f.id) })).filter(g => g.cats.length),
    loose: cats.filter(c => !folderOfCategory(c)),
  };
};

// =====================================================================
// 칩 줄
// =====================================================================
const catChipHtml = (c, sel, marks) => `
  <button type="button" class="pick-chip slot-${c.slot}${c.id === sel ? ' on' : ''}" data-pick="${escapeHtml(c.id)}" data-cat-id="${escapeHtml(c.id)}" data-cat-kind="${c.kind}" aria-pressed="${c.id === sel}">
    <i class="swatch slot-${c.slot}"></i>${escapeHtml(c.name)}${marks.has(c.id) ? '<span class="pick-mark" title="등록됨">✓</span>' : ''}
  </button>`;

export function chipPickerHtml(kind, selectedId, { marks } = {}) {
  const markSet = marks instanceof Set ? marks : new Set(marks || []);
  const { cats, groups, loose } = groupsOf(kind);
  const sel = cats.some(c => c.id === selectedId) ? selectedId : '';
  const selCat = sel ? cats.find(c => c.id === sel) : null;
  const selGroup = selCat ? folderOfCategory(selCat) : null;
  return `
    <div class="cat-picker" data-kind="${kind}" data-selected="${escapeHtml(sel)}" data-marks="${escapeHtml([...markSet].join(','))}" role="group" aria-label="카테고리">
      <div class="pick-row">
        ${groups.map(({ f, cats: inside }) => {
          const on = selGroup === f.id;
          return `
            <button type="button" class="pick-chip group${on ? ' on' : ''}" data-group="${escapeHtml(f.id)}" data-cat-kind="${kind}" aria-expanded="false">
              ${dotsHtml(inside)}<span class="group-name">${escapeHtml(f.name)}${on ? `<span class="group-sel"> › ${escapeHtml(selCat.name)}</span>` : ''}</span>
              ${on ? '' : `<span class="group-count">${inside.length}</span>`}
            </button>`;
        }).join('')}
        ${loose.map(c => catChipHtml(c, sel, markSet)).join('')}
        <button type="button" class="pick-chip more" data-pick-more hidden>＋0</button>
        <button type="button" class="pick-chip ghost" data-pick-add>＋ ${cats.length ? '추가' : '카테고리 추가'}</button>
      </div>
      <div class="pick-open" hidden></div>
    </div>`;
}

export const pickedCategory = root => root.querySelector('.cat-picker')?.dataset.selected || null;
const marksOf = picker => new Set((picker.dataset.marks || '').split(',').filter(Boolean));

/** 같은 자리에서 칩 줄을 새로 그린다 (선택 바뀜, 새 카테고리 등) */
function redrawPicker(picker, selectedId) {
  if (!picker?.isConnected) return null;
  const tmp = document.createElement('div');
  tmp.innerHTML = chipPickerHtml(picker.dataset.kind, selectedId, { marks: marksOf(picker) });
  const next = tmp.firstElementChild;
  next._onPick = picker._onPick;
  picker.replaceWith(next);
  watchPicker(next);
  return next;
}

/** 최대 2줄까지만 보이고, 넘치는 칩은 숨기고 [＋N]으로 */
function fitPicker(picker) {
  const row = picker.querySelector('.pick-row');
  if (!row || !row.offsetParent) return;
  const items = [...row.querySelectorAll('[data-pick], [data-group]')].filter(x => x.parentElement === row);
  const more = row.querySelector('[data-pick-more]');
  const add = row.querySelector('[data-pick-add]');
  items.forEach(x => { x.hidden = false; });
  more.hidden = true;
  if (!items.length) return;
  const top0 = items[0].offsetTop;
  const lineH = items[0].offsetHeight + 6;
  const fits = el => el.offsetTop < top0 + lineH * 2 - 2;
  if ([...items, add].every(fits)) return;
  more.hidden = false;
  let hidden = 0;
  for (let i = items.length - 1; i >= 0 && !(fits(more) && fits(add)); i--) {
    if (items[i].classList.contains('on')) continue; // 고른 칩은 숨기지 않는다
    items[i].hidden = true;
    hidden++;
  }
  more.textContent = `＋${hidden}`;
  more.setAttribute('aria-label', `카테고리 ${hidden}개 더 보기`);
}

// 칩 줄이 화면에 나타나거나 폭이 바뀌면 다시 맞춘다
const resizeObs = new ResizeObserver(entries => entries.forEach(e => {
  const w = Math.round(e.contentRect.width);
  if (w && w !== e.target._fitW) { e.target._fitW = w; fitPicker(e.target); }
}));
function watchPicker(p) {
  if (p._watched) return;
  p._watched = true;
  resizeObs.observe(p);
  requestAnimationFrame(() => fitPicker(p));
}
new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.matches?.('.cat-picker')) watchPicker(n);
    n.querySelectorAll?.('.cat-picker').forEach(watchPicker);
  }
}).observe(document.body, { childList: true, subtree: true });

function selectInPicker(picker, id, onPick) {
  const next = redrawPicker(picker, id || '');
  onPick?.(id || null, next || picker);
}

/** root 안의 칩 줄을 연결. 같은 칩을 다시 누르면 선택 해제(미분류). onPick(id | null, picker) */
export function bindChipPicker(root, onPick) {
  root.addEventListener('click', e => {
    const picker = e.target.closest('.cat-picker');
    if (!picker || !root.contains(picker)) return;
    picker._onPick = onPick;
    const kind = picker.dataset.kind;

    const chip = e.target.closest('[data-pick]');
    if (chip) {
      const id = picker.dataset.selected === chip.dataset.pick ? '' : chip.dataset.pick;
      return selectInPicker(picker, id, onPick);
    }
    const group = e.target.closest('[data-group]');
    if (group) {
      const open = picker.querySelector('.pick-open');
      const fid = group.dataset.group;
      const closing = picker.dataset.open === fid;
      picker.querySelectorAll('[data-group]').forEach(g => g.setAttribute('aria-expanded', 'false'));
      if (closing) { picker.dataset.open = ''; open.hidden = true; return; }
      picker.dataset.open = fid;
      group.setAttribute('aria-expanded', 'true');
      const inside = categoriesOf(kind).filter(c => folderOfCategory(c) === fid);
      open.innerHTML = inside.map(c => catChipHtml(c, picker.dataset.selected, marksOf(picker))).join('');
      open.hidden = false;
      return;
    }
    if (e.target.closest('[data-pick-more]')) return openDrawer(kind, { origin: picker, onPick });
    if (e.target.closest('[data-pick-add]')) return openDrawer(kind, { origin: picker, onPick, focusAdd: true });
  });
}

// =====================================================================
// 길게 누르기 (PC는 우클릭) → 정리 모드
// =====================================================================
export function bindCategoryLongPress(root) {
  let timer = null;
  let fired = false;
  let start = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  const targetOf = el => el.closest('[data-cat-id], [data-group]');
  const open = t => openDrawer(t.dataset.catKind || t.closest('[data-kind]')?.dataset.kind || 'task', {
    edit: true, focusId: t.dataset.catId || null, focusGroup: t.dataset.group || null,
  });

  root.addEventListener('pointerdown', e => {
    const t = targetOf(e.target);
    if (!t || e.button > 0) return;
    fired = false;
    start = { x: e.clientX, y: e.clientY };
    cancel();
    timer = setTimeout(() => { fired = true; buzz(15); open(t); }, 500);
  });
  root.addEventListener('pointermove', e => {
    if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel();
  });
  ['pointerup', 'pointercancel'].forEach(t => root.addEventListener(t, cancel));
  root.addEventListener('click', e => {
    if (fired && targetOf(e.target)) { e.stopPropagation(); e.preventDefault(); fired = false; }
  }, true);
  root.addEventListener('contextmenu', e => {
    const t = targetOf(e.target);
    if (!t) return;
    e.preventDefault();
    if (!fired) { cancel(); open(t); }
  });
}

/** 예전 이름 호환: 관리 창 열기 = 정리 모드로 서랍 열기 */
export const openCategoryManager = (kind, focusId = null) => openDrawer(kind, { edit: true, focusId });

// =====================================================================
// 서랍 (아래에서 올라오는 공간) + 정리 모드
// =====================================================================
let st = null; // { kind, edit, origin, onPick, focusId, focusGroup, editId, naming, query }

export function openDrawer(kind, opts = {}) {
  st = { kind, edit: !!opts.edit, origin: opts.origin || null, onPick: opts.onPick || null,
    focusId: opts.focusId || null, focusGroup: opts.focusGroup || null, editId: null, naming: null, query: '' };
  renderDrawer();
  if (!isOpen(drawer)) openOverlay({ el: drawer, layer: 3, onClose: () => { st = null; } });
  document.activeElement?.blur?.(); // 키보드가 올라와 있으면 내린다
  if (opts.focusAdd) drawer.querySelector('.d-add input')?.focus();
  const flash = st.focusId && drawer.querySelector(`[data-chip="${CSS.escape(st.focusId)}"]`);
  flash?.classList.add('flash');
  flash?.scrollIntoView({ block: 'nearest' });
}

const rerender = () => { if (st) renderDrawer(); };

function drawerChipHtml(c) {
  const sel = !st.edit && st.origin?.dataset.selected === c.id;
  const hit = st.query && !c.name.includes(st.query);
  if (st.edit) {
    return `
      <div class="pick-chip d-chip slot-${c.slot}${st.editId === c.id ? ' editing' : ''}" data-chip="${escapeHtml(c.id)}" role="button" tabindex="0" aria-label="${escapeHtml(c.name)} 고치기, 끌어서 옮기기">
        <i class="swatch slot-${c.slot}"></i>${escapeHtml(c.name)}
        <button type="button" class="chip-x" data-act="remove" aria-label="${escapeHtml(c.name)} 삭제">×</button>
      </div>`;
  }
  return `<button type="button" class="pick-chip d-chip slot-${c.slot}${sel ? ' on' : ''}" data-chip="${escapeHtml(c.id)}"${hit ? ' hidden' : ''}><i class="swatch slot-${c.slot}"></i>${escapeHtml(c.name)}</button>`;
}

function renderDrawer() {
  const { kind, edit } = st;
  const { cats, groups, loose } = groupsOf(kind);
  const editCat = st.editId ? cats.find(c => c.id === st.editId) : null;
  const naming = st.naming ? store.get('catFolders', st.naming) : null;
  const showSearch = !edit && cats.length > 15;
  const visible = list => (st.query ? list.filter(c => c.name.includes(st.query)) : list);

  const section = (id, title, list, isGroup) => {
    if (st.query && !visible(list).length) return '';
    return `
      <section class="d-group${isGroup ? '' : ' loose'}${st.focusGroup === id ? ' flash' : ''}" data-section="${escapeHtml(id || '')}">
        ${isGroup ? `
          <div class="d-group-head" data-group-head="${escapeHtml(id)}">
            ${dotsHtml(list)}
            ${edit ? `<input class="g-name" type="text" maxlength="${MAX_NAME}" value="${escapeHtml(title)}" aria-label="묶음 이름" />` : `<span class="g-title">${escapeHtml(title)}</span>`}
            <span class="group-count">${list.length}</span>
            ${edit ? '<button type="button" class="ungroup-btn" data-act="ungroup">풀기</button>' : ''}
          </div>` : (title ? `<div class="d-group-head loose-head">${title}</div>` : '')}
        <div class="d-chips">${list.map(drawerChipHtml).join('')}${edit && !list.length ? '<span class="d-empty">여기로 끌어 놓기</span>' : ''}</div>
      </section>`;
  };

  drawer.innerHTML = `
    <div class="modal-box drawer${edit ? ' editing' : ''}">
      <div class="sheet-grip" aria-hidden="true"><i></i></div>
      <div class="drawer-head">
        <strong>${edit ? '정리 중' : `${KIND_LABEL[kind]} 카테고리`}</strong>
        ${edit
          ? '<button type="button" class="done-btn" data-act="done">완료</button>'
          : (cats.length ? '<button type="button" class="pill-btn small" data-act="edit">정리하기</button>' : '')}
        <button type="button" class="icon-btn close-btn" data-close aria-label="닫기">✕</button>
      </div>

      ${naming ? `
        <div class="naming-card">
          <p>✨ 새 묶음이 생겼어요. 이름을 붙여볼까요?</p>
          <input class="n-name" type="text" maxlength="${MAX_NAME}" value="${escapeHtml(naming.name)}" aria-label="묶음 이름" />
          <div class="suggest-row">${SUGGEST[kind].map(s => `<button type="button" class="suggest-chip" data-suggest="${s}">${s}</button>`).join('')}</div>
          <div class="naming-actions">
            <button type="button" class="pill-btn" data-act="name-later">나중에</button>
            <button type="button" class="primary-btn" data-act="name-ok">좋아요</button>
          </div>
        </div>` : ''}

      ${edit && editCat ? `
        <div class="edit-card">
          <div class="edit-line">
            <i class="swatch big slot-${editCat.slot}"></i>
            <input class="e-name" type="text" maxlength="${MAX_NAME}" value="${escapeHtml(editCat.name)}" aria-label="카테고리 이름" />
            <span class="muted small">${usageCount(editCat)}개 사용</span>
          </div>
          <div class="slot-row">${SLOTS.map(s => `<button type="button" class="slot-swatch slot-${s}${s === editCat.slot ? ' picked' : ''}" data-slot="${s}" title="${slotTitle(s)}" aria-label="${slotTitle(s)}"></button>`).join('')}</div>
          <div class="edit-actions">
            <button type="button" class="pill-btn danger-text" data-act="remove-editing">삭제</button>
            <button type="button" class="pill-btn" data-act="close-edit">다 고쳤어요</button>
          </div>
        </div>` : ''}

      ${edit ? '<p class="edit-hint">칩을 끌어 <b>다른 칩 위에 겹치면</b> 묶음이 생겨요 · 묶음 밖으로 끌면 꺼내져요 · 누르면 이름·색 고치기</p>' : ''}
      ${showSearch ? `<input class="d-search" type="search" placeholder="🔍 카테고리 찾기" value="${escapeHtml(st.query)}" aria-label="카테고리 찾기" />` : ''}

      <div class="drawer-body">
        ${groups.map(g => section(g.f.id, g.f.name, g.cats, true)).join('')}
        ${section('', groups.length ? '묶지 않은 것' : '', loose, false)}
        ${!cats.length ? '<p class="empty">아직 카테고리가 없어요. 아래에 적어 추가해보세요.</p>' : ''}
      </div>

      <form class="d-add">
        <input type="text" maxlength="${MAX_NAME}" placeholder="＋ 새 카테고리 (${ADD_HINT[kind]})" autocomplete="off" aria-label="새 카테고리 이름" />
        <button class="primary-btn">추가</button>
      </form>
      <p class="form-error" hidden></p>
    </div>`;
}

const showError = msg => { const p = drawer.querySelector('.form-error'); if (p) { p.textContent = msg; p.hidden = false; } };

// ---- 삭제 (되돌리기: 카테고리 + 그 때문에 사라진 빈 묶음까지) ----
function removeCategory(id) {
  const cat = store.get('categories', id);
  if (!cat) return;
  let snap = null;
  let removedFolders = [];
  store.batch(() => {
    snap = deleteCategory(id);
    removedFolders = cleanupEmptyFolders(cat.kind);
  });
  const n = Object.values(snap.moved).reduce((s, ids) => s + ids.length, 0);
  if (st?.editId === id) st.editId = null;
  rerender();
  toast(`${josa(`'${cat.name}' 카테고리`, '을', '를')} 지웠어요${n ? ` · ${n}개는 미분류로` : ''}`, {
    label: '되돌리기',
    run: () => {
      store.batch(() => { removedFolders.forEach(f => store.restore('catFolders', f)); restoreCategory(snap); });
      rerender();
    },
  }, 8000);
}

// ---- 클릭 ----
drawer.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) return closeOverlay(drawer);
  if (!st) return;
  if (justDragged) { justDragged = false; return; }
  const act = e.target.closest('[data-act]')?.dataset.act;

  if (act === 'edit') { st.edit = true; return rerender(); }
  if (act === 'done') { st.edit = false; st.editId = null; st.naming = null; return st.origin ? rerender() : closeOverlay(drawer); }
  if (act === 'close-edit') { st.editId = null; return rerender(); }
  if (act === 'remove') return removeCategory(e.target.closest('[data-chip]').dataset.chip);
  if (act === 'remove-editing') return removeCategory(st.editId);

  if (act === 'ungroup') {
    const fid = e.target.closest('[data-group-head]').dataset.groupHead;
    const f = store.get('catFolders', fid);
    const snap = deleteFolder(fid);
    rerender();
    return toast(`'${f.name}' 묶음을 풀었어요`, { label: '되돌리기', run: () => { restoreFolder(snap); rerender(); } }, 8000);
  }

  const sug = e.target.closest('[data-suggest]');
  if (sug) { drawer.querySelector('.n-name').value = sug.dataset.suggest; return; }
  if (act === 'name-ok' || act === 'name-later') {
    if (act === 'name-ok') {
      try { updateFolder(st.naming, { name: drawer.querySelector('.n-name').value }); } catch (err) { return showError(err.message); }
    }
    st.naming = null;
    return rerender();
  }

  const slot = e.target.closest('[data-slot]');
  if (slot && st.editId) { updateCategory(st.editId, { slot: Number(slot.dataset.slot) }); return rerender(); }

  const chip = e.target.closest('[data-chip]');
  if (chip) {
    const id = chip.dataset.chip;
    if (st.edit) { st.editId = st.editId === id ? null : id; return rerender(); }
    // 고르기 → 원래 칩 줄에 반영하고 닫기
    const { origin, onPick } = st;
    const same = origin?.dataset.selected === id;
    closeOverlay(drawer);
    if (origin) selectInPicker(origin, same ? '' : id, onPick);
  }
});

drawer.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('.e-name, .g-name')) { e.preventDefault(); e.target.blur(); }
  if (e.key === 'Enter' && e.target.matches('.n-name')) { e.preventDefault(); drawer.querySelector('[data-act="name-ok"]')?.click(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.d-chip[role="button"]')) { e.preventDefault(); e.target.click(); }
});

drawer.addEventListener('change', e => {
  if (!st) return;
  try {
    if (e.target.matches('.e-name') && st.editId) { updateCategory(st.editId, { name: e.target.value }); rerender(); }
    if (e.target.matches('.g-name')) { updateFolder(e.target.closest('[data-group-head]').dataset.groupHead, { name: e.target.value }); }
  } catch (err) { rerender(); showError(err.message); }
});

drawer.addEventListener('input', e => {
  if (!st || !e.target.matches('.d-search')) return;
  st.query = e.target.value.trim();
  const pos = e.target.selectionStart;
  rerender();
  const s = drawer.querySelector('.d-search');
  s.focus();
  s.setSelectionRange(pos, pos);
});

drawer.addEventListener('submit', e => {
  e.preventDefault();
  if (!st || !e.target.matches('.d-add')) return;
  const input = e.target.querySelector('input');
  const name = input.value.trim();
  if (!name) return;
  const { kind, origin, onPick, edit } = st;
  const id = newCategoryId();
  // 칩 줄에서 [＋ 추가]로 왔으면: 먼저 '마지막 선택'으로 기억 → 만들고 → 고른 상태로 닫기
  if (origin && !edit) onPick?.(id, origin);
  try {
    addCategory(kind, name, { id });
  } catch (err) { return showError(err.message); }
  if (origin && !edit) {
    closeOverlay(drawer);
    if (origin.isConnected) selectInPicker(origin, id, null);
    return;
  }
  rerender();
  drawer.querySelector('.d-add input')?.focus();
});

// =====================================================================
// 정리 모드: 끌어서 겹치기·옮기기 (칩) / 묶음 순서 바꾸기 (머리줄)
// =====================================================================
let drag = null;
let justDragged = false;

function clearMarks() {
  drawer.querySelectorAll('.merge-target, .ins-before, .ins-after, .drop-section, .sec-before, .sec-after')
    .forEach(el => el.classList.remove('merge-target', 'ins-before', 'ins-after', 'drop-section', 'sec-before', 'sec-after'));
}

drawer.addEventListener('pointerdown', e => {
  if (!st?.edit || e.button > 0 || e.target.closest('input, .chip-x, button:not(.d-chip)')) return;
  const chip = e.target.closest('.d-chip');
  const head = !chip && e.target.closest('.d-group-head:not(.loose-head)');
  if (!chip && !head) return;
  drag = { el: chip || head.closest('.d-group'), isGroup: !chip, x: e.clientX, y: e.clientY, started: false, pointerId: e.pointerId, target: null };
});

drawer.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    drag.started = true;
    try { drawer.setPointerCapture(drag.pointerId); } catch {}
    const r = drag.el.getBoundingClientRect();
    const ghost = (drag.isGroup ? drag.el.querySelector('.d-group-head') : drag.el).cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${(drag.isGroup ? drag.el.querySelector('.d-group-head') : drag.el).offsetWidth}px`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.dx = e.clientX - r.left;
    drag.dy = e.clientY - r.top;
    drag.el.classList.add('drag-src');
    buzz(10);
  }
  e.preventDefault();
  drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px)`;

  const body = drawer.querySelector('.drawer-body');
  const b = body.getBoundingClientRect();
  if (e.clientY < b.top + 30) body.scrollTop -= 8;
  else if (e.clientY > b.bottom - 30) body.scrollTop += 8;

  clearMarks();
  drag.target = null;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (!under || !drawer.contains(under)) return;

  if (drag.isGroup) {
    const sec = under.closest('.d-group:not(.loose)');
    if (!sec || sec === drag.el) return;
    const r = sec.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    sec.classList.add(before ? 'sec-before' : 'sec-after');
    drag.target = { type: 'group', id: sec.dataset.section, before };
    return;
  }

  const chip = under.closest('.d-chip');
  if (chip && chip !== drag.el) {
    const r = chip.getBoundingClientRect();
    const rx = (e.clientX - r.left) / r.width;
    const sec = chip.closest('.d-group');
    const inGroup = !sec.classList.contains('loose');
    if (!inGroup && rx > 0.25 && rx < 0.75) {
      chip.classList.add('merge-target');
      drag.target = { type: 'merge', id: chip.dataset.chip };
    } else {
      const after = rx >= 0.5;
      chip.classList.add(after ? 'ins-after' : 'ins-before');
      drag.target = { type: 'insert', folderId: sec.dataset.section || null, ref: chip.dataset.chip, after };
    }
    return;
  }
  const sec = under.closest('.d-group');
  if (sec) {
    sec.classList.add('drop-section');
    drag.target = { type: 'append', folderId: sec.dataset.section || null };
  }
});

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.started) return; // 그냥 누른 것 → click에서 고치기
  justDragged = true;
  setTimeout(() => { justDragged = false; }, 0);
  d.ghost?.remove();
  d.el.classList.remove('drag-src');
  clearMarks();
  const t = d.target;
  if (!t || !st) return;
  const kind = st.kind;

  if (d.isGroup) {
    const ids = foldersOf(kind).map(f => f.id).filter(id => id !== d.el.dataset.section);
    const idx = ids.indexOf(t.id) + (t.before ? 0 : 1);
    ids.splice(idx, 0, d.el.dataset.section);
    arrangeCategories({ folders: ids });
    return rerender();
  }

  const srcId = d.el.dataset.chip;
  let folder = null;
  store.batch(() => {
    if (t.type === 'merge') folder = createGroupFrom(srcId, t.id);
    else if (t.type === 'insert') moveCategoryTo(srcId, t.folderId, t.ref, t.after);
    else moveCategoryTo(srcId, t.folderId);
    cleanupEmptyFolders(kind);
  });
  if (folder) { st.naming = folder.id; buzz([10, 40, 10]); }
  rerender();
  if (folder) { const n = drawer.querySelector('.n-name'); n?.focus(); n?.select(); }
}
drawer.addEventListener('pointerup', endDrag);
drawer.addEventListener('pointercancel', endDrag);
drawer.addEventListener('touchmove', e => { if (drag?.started) e.preventDefault(); }, { passive: false });
