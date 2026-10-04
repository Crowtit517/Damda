// 담다(Damda) 진입점: 화면 전환(☰ 메뉴), 제목, 테마, 동기화 메뉴, 단축키, PWA 서비스 워커 등록.
import { migrateCategories } from './categories.js';
import { store, dataPlace } from './store.js';
import { purgeSamples } from './sample.js';
import { runRecurring } from './recurring.js';
import { openOverlay, closeOverlay, toggleOverlay, closeOnBackdrop, topOverlay, isOpen } from './ui/overlay.js';
import { toast } from './ui/toast.js';
import { choiceDialog } from './ui/dialog.js';
import * as sync from './sync/engine.js';
import * as gcal from './sync/gcal.js';
import { isConfigured } from './sync/google.js';
import { getSetting, setSetting, isTouchDevice, buzz } from './settings.js';
import * as calendar from './views/calendar.js';
import * as tasks from './views/tasks.js';
import * as ledger from './views/ledger.js';
import * as dayPanel from './views/dayPanel.js';
import { openGuide } from './parts/guide.js';
import { isDesk } from './desk.js';
import { mountDeskSide, markDeskTab } from './parts/deskSide.js';
import { hideBootSplash } from './ui/bootSplash.js';
import { startReminders } from './reminders.js';
import { isNative } from './native.js';
import { todayKey, loadPref, savePref, escapeHtml } from './utils.js';

migrateCategories();
purgeSamples();

// 날짜가 된 고정 수입·지출을 기록 (앱을 열 때, 다시 볼 때, 자정이 지날 때)
function recordRecurring() {
  const n = runRecurring();
  if (n) toast(`고정 항목 ${n}건을 기록했어요`);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) recordRecurring(); });

// ---- 화면 (☰ 메뉴에서 고른다. 제목에 지금 화면을 표시) ----
const SCREENS = {
  calendar: { label: '캘린더', desc: '한 달 훑어보기', view: calendar },
  tasks: { label: '할 일', desc: '오늘 할 일과 반복', view: tasks },
  ledger: { label: '가계부', desc: '지출·수입과 통계', view: ledger },
};
const titleEl = document.getElementById('screenTitle');
// 앱 아이콘 바로가기(?tab=tasks)로 열면 그 화면부터
let tab = new URLSearchParams(location.search).get('tab') || loadPref('ple-tab', 'calendar');
if (!SCREENS[tab]) tab = 'calendar';

function showTab(next) {
  if (isDesk) return showDeskTab(next);
  tab = next;
  savePref('ple-tab', tab);
  for (const name of Object.keys(SCREENS)) document.getElementById(`view-${name}`).hidden = name !== tab;
  const s = SCREENS[tab];
  titleEl.textContent = s.label;
  document.title = `${s.label} · 담다`;
  if (tab !== 'calendar' && dayPanel.isPanelOpen()) closeOverlay(document.getElementById('dayPanel'));
  s.view.render();
}

// PC 앱: 캘린더는 늘 왼쪽에 보이고, tab 은 오른쪽 구역에 무엇을 보일지 (calendar = 이 날)
function showDeskTab(next) {
  const changed = next !== tab;
  tab = next;
  savePref('ple-tab', tab);
  document.getElementById('view-calendar').hidden = false;
  for (const name of ['tasks', 'ledger']) document.getElementById(`view-${name}`).hidden = name !== tab;
  const panel = document.getElementById('dayPanel');
  if (tab === 'calendar') dayPanel.openDayPanel(dayPanel.currentPanelKey() || todayKey());
  else { panel.hidden = true; panel.classList.remove('open'); }
  markDeskTab(tab);
  titleEl.textContent = SCREENS.calendar.label;
  document.title = '담다';
  calendar.render();
  if (tab !== 'calendar') SCREENS[tab].view.render();
  // 탭을 바꾸면 맨 위부터 (예전에 내려 둔 위치가 남아 있지 않게)
  if (changed) (tab === 'calendar' ? panel.querySelector('.panel-body') : document.getElementById(`view-${tab}`)).scrollTop = 0;
}

// 데이터가 바뀌면 보이는 화면만 다시 그린다
store.subscribe(() => {
  SCREENS[tab].view.render();
  if (isDesk && tab !== 'calendar') calendar.render(); // PC 앱은 캘린더가 늘 보인다
  dayPanel.render();
});
window.addEventListener('ple:panelchange', () => {
  // PC 앱: 할 일·가계부 탭을 보다가 달력 날짜를 누르면 [이 날] 탭으로
  if (isDesk && tab !== 'calendar' && dayPanel.isPanelOpen()) return showDeskTab('calendar');
  if (tab === 'calendar' || isDesk) calendar.render();
});

// 캘린더 패널에서 '할 일에서 열기 / 가계부에서 기록하기' → 그 화면의 그 날짜로
window.addEventListener('ple:goto', e => {
  const { tab: next, key } = e.detail;
  if (!SCREENS[next]?.view.setDate) return;
  closeOverlay(document.getElementById('dayPanel'));
  SCREENS[next].view.setDate(key);
  showTab(next);
});

// ---- 테마: 저장된 값이 없으면 기기 설정을 따른다 ----
const themeToggle = document.getElementById('themeToggle');
const currentTheme = () => document.documentElement.dataset.theme
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  const dark = currentTheme() === 'dark';
  themeToggle.textContent = dark ? '🌙' : '☀️';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0e1018' : '#6b74c9';
}
themeToggle.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  savePref('ple-theme', next);
  applyTheme(next);
});
applyTheme(loadPref('ple-theme', null));

// ---- ? 사용 가이드: 지금 화면의 설명부터 연다 ----
document.getElementById('helpBtn').addEventListener('click', () => openGuide(tab === 'calendar' ? 'calendar' : tab));

// ---- ☰ 메뉴 (왼쪽에서 열리는 서랍): 화면 · 동기화 · 구글 캘린더 · 설정 ----
// 동기화는 구글 계정을 연결하면 항상 자동 (절약 모드만 켜고 끈다).
// "보기"(구글 캘린더 칸에서 여러 개 켜기)와 "담는 곳 고르기"(설정 칸에서 하나씩)를 나눈다.
const menu = document.getElementById('menuModal');
menu.classList.add('side-wrap');
const syncPill = document.getElementById('syncPill');
let showMoreAccounts = false; // 추가 계정 목록 펼침

function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return '방금';
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.round(s / 60)}분 전`;
  return `${Math.round(s / 3600)}시간 전`;
}

// 오른쪽 위 작은 표시
function renderSyncPill() {
  const st = sync.getStatus();
  let state = 'local';
  let text = '이 기기에 저장';
  let sub = ''; // 좁은 화면에서는 숨기는 덧붙임 (예: "· 3분 전")
  if (sync.isConnected()) {
    if (st.phase === 'syncing') { state = 'syncing'; text = '맞추는 중…'; }
    else if (st.phase === 'need-login') { state = 'waiting'; text = '다시 로그인 필요'; }
    else if (st.phase === 'error') { state = 'error'; text = '동기화 오류'; }
    else { state = 'on'; text = st.lastSync ? '동기화됨' : '동기화 켜짐'; sub = st.lastSync ? ` · ${ago(st.lastSync)}` : ''; }
  }
  syncPill.dataset.state = state;
  // 좁은 화면에서는 앞말을 빼고 짧게: "다시 로그인 필요" → "로그인 필요"
  const SHORT_PREFIX = { '다시 로그인 필요': '다시 ', '이 기기에 저장': '이 ' };
  const pre = SHORT_PREFIX[text] || '';
  syncPill.lastElementChild.innerHTML = `${pre ? `<span class="pill-pre">${pre}</span>` : ''}${escapeHtml(text.slice(pre.length))}${sub ? `<span class="pill-sub">${escapeHtml(sub)}</span>` : ''}`;
  syncPill.title = text + sub;
}

function syncCardHtml() {
  const acc = sync.account();
  if (!acc) {
    return `
      <div class="sync-card">
        <button type="button" class="google-btn" data-act="google-connect">
          <span class="g-mark" aria-hidden="true">G</span> 구글 계정으로 연결
          ${isConfigured() ? '' : '<span class="soon">설정 필요</span>'}
        </button>
        <p class="muted small sync-foot">연결 전에는 이 기기에만 저장돼요. 연결하면 할 일·가계부는 PC·폰과, 일정은 폰 캘린더와 자동으로 맞춰요.</p>
      </div>`;
  }
  const st = sync.getStatus();
  const saver = sync.syncMode() === 'saver';
  const place = dataPlace();
  let line;
  if (st.phase === 'need-login') line = '<span class="sync-dot warn"></span>로그인이 만료됐어요. 다시 로그인하면 이어서 맞춰요';
  else if (st.phase === 'error') line = `<span class="sync-dot err"></span>${escapeHtml(st.message)}`;
  else line = `<span class="sync-dot ok"></span>${escapeHtml(place || acc.email || '구글 계정')}${st.lastSync ? ` · ${ago(st.lastSync)} 맞춤` : ''}`;
  return `
    <div class="sync-card">
      <div class="sync-status">${line}</div>
      ${st.phase === 'need-login' ? '<button type="button" class="google-btn" data-act="google-reconnect"><span class="g-mark" aria-hidden="true">G</span> 다시 로그인</button>' : ''}
      <p class="muted small sync-desc">${saver ? '절약 모드: 앱을 열 때와 돌아올 때만 맞춰요.' : '자동 동기화: 저장하면 1초 안에 올리고, 보는 동안 5초마다 맞춰요.'}</p>
      <button type="button" class="set-row" data-act="toggle-saver" role="switch" aria-checked="${saver}">
        <span class="side-text"><strong>절약 모드</strong><span class="muted small">배터리와 데이터를 아껴요</span></span>
        <span class="switch${saver ? ' on' : ''}" aria-hidden="true"></span>
      </button>
      ${saver ? `<button type="button" class="pill-btn" data-act="sync-now"${st.phase === 'syncing' ? ' disabled' : ''}>${st.phase === 'syncing' ? '맞추는 중…' : '지금 맞추기'}</button>` : ''}
    </div>`;
}

// 구글 캘린더: 기본 계정은 펼쳐 두고, 추가 계정은 "다른 계정 N개 ▾"로 접는다
const ACCT_STATE = { ok: '', 'read-only': '보기만', 'need-login': '다시 로그인 필요', 'need-scope': '권한 필요', error: '오류' };

function accountBlockHtml(a, st, cals) {
  const state = st.accounts?.[a.key];
  const list = cals.filter(c => c.acct === a.key);
  return `
    <div class="gcal-acct">
      <div class="gcal-acct-head">
        <span class="gcal-acct-name"><strong>${escapeHtml(a.email || '기본 계정')}</strong><span class="muted small">${a.main ? '기본 계정' : '추가 계정'}${ACCT_STATE[state] ? ` · ${ACCT_STATE[state]}` : ''}</span></span>
        ${!a.main && state === 'need-login' ? `<button type="button" class="pill-btn small" data-act="gcal-relogin" data-email="${escapeHtml(a.email)}">다시 로그인</button>` : ''}
        ${!a.main ? `<button type="button" class="pill-btn small danger-text" data-act="gcal-remove" data-email="${escapeHtml(a.email)}">빼기</button>` : ''}
      </div>
      ${list.length ? `
        <div class="gcal-list" role="group" aria-label="${escapeHtml(a.email)} 캘린더">
          ${list.map(c => `
            <button type="button" class="set-row gcal-row" data-gcal-acct="${escapeHtml(c.acct)}" data-gcal-cal="${escapeHtml(c.id)}" role="switch" aria-checked="${c.visible}">
              <i class="gcal-color" style="background:${escapeHtml(c.color)}" aria-hidden="true"></i>
              <span class="side-text"><strong>${escapeHtml(c.name)}</strong>${c.writable ? '' : '<span class="muted small">보기만</span>'}</span>
              <span class="switch${c.visible ? ' on' : ''}" aria-hidden="true"></span>
            </button>`).join('')}
        </div>` : ''}
    </div>`;
}

function gcalCardHtml() {
  if (!sync.account()) {
    return '<div class="sync-card"><p class="muted small gcal-note">구글 계정을 연결하면 폰(삼성·구글·노션) 캘린더 일정이 담다에 함께 보이고, 서로 맞춰져요.</p></div>';
  }
  if (!gcal.isEnabled()) {
    return `
      <div class="sync-card">
        <button type="button" class="google-btn" data-act="gcal-connect"><span class="g-mark cal" aria-hidden="true">📅</span> 구글 캘린더 다시 켜기</button>
        <p class="muted small gcal-note">켜면 폰 캘린더와 담다의 <b>일정</b>이 서로 맞춰져요. 할 일과 가계부는 담다에만 있어요.</p>
      </div>`;
  }
  const st = gcal.getStatus();
  const cals = gcal.calendars();
  const accts = gcal.accounts();
  const [main, ...others] = accts;
  let line;
  if (st.phase === 'loading') line = '<span class="sync-dot"></span>일정을 불러오는 중…';
  else if (st.phase === 'need-login') line = '<span class="sync-dot warn"></span>구글 로그인이 끝나면 일정을 맞춰요';
  else if (st.phase === 'need-scope') line = '<span class="sync-dot warn"></span>캘린더 권한이 없어요';
  else if (st.phase === 'error') line = `<span class="sync-dot err"></span>${escapeHtml(st.message)}`;
  else line = `<span class="sync-dot ok"></span>${st.lastFetch ? `${ago(st.lastFetch)} 맞춤` : '연결됨'}${st.outbox ? ` · 보낼 일정 ${st.outbox}개` : ''}`;
  const mainState = st.accounts?.main;
  return `
    <div class="sync-card">
      <div class="sync-status">${line}</div>
      ${mainState === 'need-scope' || mainState === 'read-only' ? `
        <button type="button" class="google-btn" data-act="gcal-connect"><span class="g-mark cal" aria-hidden="true">📅</span> ${mainState === 'read-only' ? '일정 수정도 허락하기' : '캘린더 권한 허락하기'}</button>` : ''}
      ${accountBlockHtml(main, st, cals)}
      ${others.length ? `
        <button type="button" class="acct-toggle" data-act="toggle-accounts" aria-expanded="${showMoreAccounts}">다른 계정 ${others.length}개 <span aria-hidden="true">${showMoreAccounts ? '▴' : '▾'}</span></button>
        ${showMoreAccounts ? others.map(a => accountBlockHtml(a, st, cals)).join('') : ''}` : ''}
      <button type="button" class="pill-btn wide" data-act="gcal-add-account">＋ 다른 구글 계정 추가</button>
      <p class="muted small sync-foot">구글 계정에 저장된 일정만 보여요 (삼성 캘린더의 "내 휴대전화"·"삼성 계정" 일정은 제외). 반복 일정·공휴일·공유 캘린더는 보기만 해요. 추가 계정은 구글 클라우드의 테스트 사용자로 등록되어 있어야 해요.</p>
    </div>`;
}

// 설정: 담는 곳 고르기 + 자잘한 설정 + 구글 연결 끊기
function switchRow(key, icon, title, desc) {
  const on = getSetting(key);
  return `
    <button type="button" class="set-row" data-set="${key}" role="switch" aria-checked="${on}">
      <span class="side-icon" aria-hidden="true">${icon}</span>
      <span class="side-text"><strong>${title}</strong><span class="muted small">${desc}</span></span>
      <span class="switch${on ? ' on' : ''}" aria-hidden="true"></span>
    </button>`;
}

function settingsHtml() {
  const touch = isTouchDevice();
  const acc = sync.account();
  const writable = acc && gcal.isEnabled() ? gcal.writableCalendars() : [];
  const target = gcal.target();
  const accts = acc ? gcal.accounts() : [];
  const place = dataPlace();
  return `
    <div class="set-card">
      <label class="set-select">
        <span class="side-text"><strong>일정 담는 곳</strong><span class="muted small">담다에서 새로 만든 일정이 들어갈 캘린더를 정하는 곳이에요</span></span>
        ${writable.length ? `
          <select data-gcal-target>
            ${writable.map(c => `<option value="${escapeHtml(`${c.acct}|${c.id}`)}"${target && target.acct === c.acct && target.id === c.id ? ' selected' : ''}>${escapeHtml(c.name)}${c.name === c.accountEmail ? '' : ` (${escapeHtml(c.accountEmail)})`}</option>`).join('')}
          </select>` : `<span class="set-empty">${acc ? '구글 캘린더 권한을 허락하면 고를 수 있어요' : '구글 계정을 연결하면 고를 수 있어요'}</span>`}
      </label>
      <label class="set-select">
        <span class="side-text"><strong>할 일·가계부 담는 곳</strong><span class="muted small">할 일과 가계부를 담고, 불러와요</span></span>
        ${accts.length ? `
          <select data-data-place>
            ${accts.map(a => { const v = a.main ? '' : a.email; return `<option value="${escapeHtml(v)}"${v === place ? ' selected' : ''}>${escapeHtml(a.email || '기본 계정')}${a.main ? ' (기본)' : ''}</option>`; }).join('')}
          </select>` : '<span class="set-empty">이 기기 (구글 계정을 연결하면 고를 수 있어요)</span>'}
      </label>
      ${touch ? switchRow('vibrate', '📳', '진동', '꾹 누르기·옮기기 같은 손끝 반응') : ''}
      ${switchRow('notify', '🔔', '알림', isNative ? '할 일·담다 일정 알림 · 폰 기본 알림음 (구글 캘린더 일정은 캘린더 앱이 알려줘요)' : isDesk ? '할 일·담다 일정 알림 · 담다가 켜져 있을 때 소리 없이' : '알림 시간을 정한 할 일은 갤럭시 담다 앱에서 울려요')}
      <p class="muted small set-foot">알림은 ${touch ? '갤럭시 앱' : '구글 캘린더 연결'}부터 울려요. ${touch ? '' : 'PC에는 소리·진동이 없어요. '}설정은 이 기기에만 적용돼요.</p>
      ${acc ? '<button type="button" class="pill-btn danger-text wide" data-act="google-disconnect">구글 연결 끊기</button>' : ''}
    </div>`;
}

function renderMenu() {
  menu.innerHTML = `
    <div class="modal-box side">
      <div class="side-head">
        <div>
          <div class="side-brand">담다</div>
          <div class="muted small">하루를 담는 기록장 · Damda</div>
        </div>
        <button type="button" class="icon-btn close-btn" data-close aria-label="닫기">✕</button>
      </div>
      <div class="side-label">화면</div>
      <nav class="side-nav" aria-label="화면 선택">
        ${Object.entries(SCREENS).map(([key, s]) => `
          <button type="button" class="side-item${key === tab ? ' on' : ''}" data-screen="${key}" aria-current="${key === tab ? 'page' : 'false'}">
            <span class="side-text"><strong>${s.label}</strong><span class="muted small">${s.desc}</span></span>
          </button>`).join('')}
      </nav>
      <div class="side-label">동기화</div>
      <div class="sync-slot">${syncCardHtml()}</div>
      <div class="side-label">구글 캘린더</div>
      <div class="gcal-slot">${gcalCardHtml()}</div>
      <div class="side-label">설정</div>
      <button type="button" class="side-item settings-open" data-act="open-settings" aria-haspopup="dialog">
        <span class="side-text"><strong>⚙️ 설정</strong><span class="muted small">담는 곳 · 알림 · 진동 · 구글 연결 끊기</span></span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
    </div>`;
}

// ---- 설정 창 (☰ 메뉴의 [⚙️ 설정]을 누르면 화면 위쪽에 작은 창으로 열린다) ----
const settingsModal = document.getElementById('settingsModal');
closeOnBackdrop(settingsModal);

function openSettings() {
  settingsModal.innerHTML = `
    <div class="modal-box wide settings-box">
      <div class="modal-head">
        <strong>설정</strong>
        <button type="button" class="icon-btn close-btn" data-close aria-label="닫기">✕</button>
      </div>
      <div class="set-slot">${settingsHtml()}</div>
    </div>`;
  openOverlay({ el: settingsModal, layer: 2 });
}

// 열려 있는 메뉴·설정 창의 칸만 다시 그린다 (스크롤 위치 유지)
function refreshMenuSlots() {
  const put = (root, sel, html) => { const el = root.querySelector(sel); if (el) el.innerHTML = html; };
  if (isOpen(menu)) {
    put(menu, '.sync-slot', syncCardHtml());
    put(menu, '.gcal-slot', gcalCardHtml());
  }
  if (isOpen(settingsModal)) put(settingsModal, '.set-slot', settingsHtml());
}

sync.onStatus(() => { renderSyncPill(); refreshMenuSlots(); });
window.addEventListener('ple:gcal-notice', e => toast(e.detail));
// 구글 캘린더 일정이 바뀌면 달력·날짜 패널·메뉴를 다시 그린다
gcal.subscribe(() => {
  SCREENS[tab].view.render();
  dayPanel.render();
  refreshMenuSlots();
});
setInterval(renderSyncPill, 30 * 1000); // "3분 전" 같은 표시 갱신

closeOnBackdrop(menu);
const openMenu = () => { showMoreAccounts = false; renderMenu(); toggleOverlay({ el: menu }); }; // 추가 계정은 열 때마다 접어 둔다
document.getElementById('menuBtn').addEventListener('click', openMenu);
syncPill.addEventListener('click', openMenu);

const SETUP_GUIDE = '구글 연결을 쓰려면 먼저 구글 클라우드에서 이 앱을 등록하고, 받은 "클라이언트 ID"를 js/config.js에 넣어야 해요. 등록 방법은 채팅에서 단계별로 안내받을 수 있어요. (무료, 약 10분)';

/** 할 일·가계부 담는 곳 바꾸기: 그 계정의 기록으로 화면이 바뀐다 (다른 계정 기록은 그대로) */
async function changeDataPlace(value, select) {
  if (value === dataPlace()) return;
  try {
    if (value) {
      const { token, hasRecords } = await gcal.prepareDataPlace(value); // 그 계정의 드라이브 권한 (구글 창)
      if (!hasRecords) {
        const v = await choiceDialog({
          title: '할 일·가계부 담는 곳 바꾸기',
          message: `${value}에는 아직 담긴 할 일·가계부가 없어요. 지금 기록을 가져갈까요? 지금 계정의 기록은 그대로 남아요.`,
          choices: [{ label: '비우고 시작', value: 'empty' }, { label: '가져가기', value: 'copy' }],
        });
        if (!v) { select.value = dataPlace(); return; }
        if (v === 'copy') await gcal.copyRecordsTo(token);
      }
    }
    savePref('ple-data-acct', value);
    location.reload();
  } catch (err) {
    select.value = dataPlace();
    toast(err.message || '바꾸지 못했어요');
  }
}

function onPanelChange(e) {
  const target = e.target.closest('[data-gcal-target]');
  if (target) {
    const [acct, ...rest] = target.value.split('|');
    gcal.setTarget(acct, rest.join('|'));
    toast('새 일정은 이 캘린더에 담겨요');
    return;
  }
  const place = e.target.closest('[data-data-place]');
  if (place) changeDataPlace(place.value, place);
}

async function onPanelClick(e) {
  if (e.target.closest('[data-close]')) return closeOverlay(e.currentTarget);
  const screen = e.target.closest('[data-screen]');
  if (screen) { closeOverlay(menu); return showTab(screen.dataset.screen); }
  const set = e.target.closest('[data-set]');
  if (set) {
    const key = set.dataset.set;
    const on = !getSetting(key);
    setSetting(key, on);
    if (key === 'vibrate' && on) buzz(15);
    window.dispatchEvent(new Event('ple:settingchange')); // 알림 다시 맞추기 등
    set.setAttribute('aria-checked', on);
    set.querySelector('.switch').classList.toggle('on', on);
    return;
  }
  const calRow = e.target.closest('[data-gcal-cal]');
  if (calRow) { gcal.toggleCalendar(calRow.dataset.gcalAcct, calRow.dataset.gcalCal); return; }

  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'open-settings') { openSettings(); return; }
  if (act === 'toggle-accounts') { showMoreAccounts = !showMoreAccounts; refreshMenuSlots(); return; }
  if (act === 'toggle-saver') { sync.setSaver(sync.syncMode() !== 'saver'); refreshMenuSlots(); renderSyncPill(); return; }
  try {
    if (act === 'google-connect') {
      if (!isConfigured()) return choiceDialog({ title: '구글 연결 준비', message: SETUP_GUIDE, cancelLabel: '알겠어요', choices: [] });
      gcal.prepareConnect(); // 한 번에: 드라이브(할 일·가계부) + 캘린더(일정)
      const email = await sync.connectGoogle();
      const cal = gcal.afterConnect();
      toast(`${email || '구글 계정'}과 연결했어요${cal ? ' · 캘린더도 함께' : ''}`);
    }
    if (act === 'google-reconnect') { await sync.reconnectGoogle(); toast('다시 로그인했어요'); }
    if (act === 'sync-now') await Promise.all([sync.syncNow(), gcal.refresh()]);
    if (act === 'gcal-connect') {
      const r = await gcal.connectCalendar(sync.account()?.email || '');
      toast(r.canWrite ? `구글 캘린더 ${r.shown}개를 연결했어요 · 서로 맞춰져요` : `구글 캘린더 ${r.shown}개를 연결했어요 · 보기만`);
    }
    if (act === 'gcal-add-account') {
      const email = await gcal.addAccount();
      showMoreAccounts = true;
      toast(`${email} 캘린더를 추가했어요`);
    }
    if (act === 'gcal-relogin') await gcal.reloginAccount(e.target.closest('[data-email]').dataset.email);
    if (act === 'gcal-remove') {
      const email = e.target.closest('[data-email]').dataset.email;
      const isPlace = email === dataPlace();
      const v = await choiceDialog({
        title: '계정 빼기',
        message: `${email}의 캘린더가 담다에서 보이지 않게 돼요.${isPlace ? ' 할 일·가계부는 기본 계정의 기록으로 돌아가요.' : ''} 그 계정의 구글 캘린더와 드라이브 기록은 그대로예요.`,
        choices: [{ label: '빼기', value: 'yes', danger: true }],
      });
      if (v !== 'yes') return;
      await gcal.removeAccount(email);
      if (isPlace) { savePref('ple-data-acct', ''); location.reload(); return; }
      toast('계정을 뺐어요');
    }
    if (act === 'google-disconnect') {
      const v = await choiceDialog({
        title: '구글 연결 끊기',
        message: '이 기기의 기록은 그대로 남고, 구글과 맞추는 것만 멈춰요. 구글 드라이브와 캘린더에 있는 데이터도 지워지지 않아요.',
        choices: [{ label: '연결 끊기', value: 'yes', danger: true }],
      });
      if (v !== 'yes') return;
      const wasOther = !!dataPlace();
      sync.disconnectGoogle();
      await gcal.disconnectCalendar();
      if (wasOther) { savePref('ple-data-acct', ''); location.reload(); return; }
      toast('구글 연결을 끊었어요');
    }
  } catch (err) {
    toast(err.message || '구글과 연결하지 못했어요');
  }
  refreshMenuSlots();
  renderSyncPill();
}

for (const root of [menu, settingsModal]) {
  root.addEventListener('change', onPanelChange);
  root.addEventListener('click', onPanelClick);
}

// ---- 단축키 ----
document.addEventListener('keydown', e => {
  const typing = e.target instanceof Element && e.target.closest('input, textarea, select');

  if (e.altKey && e.code === 'KeyN') {
    e.preventDefault();
    if (dayPanel.isPanelOpen()) {
      document.querySelector('#dayPanel .task-input')?.focus();
    } else {
      if (tab !== 'tasks') showTab('tasks');
      tasks.focusInput();
    }
    return;
  }

  if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const n = e.key === 'ArrowLeft' ? -1 : 1;
  const top = topOverlay();
  if (top && top.id === 'dayPanel') dayPanel.shiftDay(n);
  else if (top) return;
  else if (tab === 'calendar') calendar.moveMonth(n);
  else SCREENS[tab].view.shiftDay(n);
});

// ---- 자정이 지나면 '오늘' 표시 갱신 ----
let lastToday = todayKey();
setInterval(() => {
  if (todayKey() === lastToday) return;
  lastToday = todayKey();
  recordRecurring();
  SCREENS[tab].view.render();
  dayPanel.render();
}, 60 * 1000);

// ---- PWA ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('서비스 워커 등록 실패', err));
  });
}

if (isDesk) mountDeskSide(showTab);
showTab(tab);
hideBootSplash();
startReminders();
recordRecurring();
// 할 일·가계부 담는 곳이 기본 계정이 아니면 알려 준다 (기록이 사라진 것처럼 오해하지 않게)
if (dataPlace()) {
  if (!gcal.accounts().some(a => a.email === dataPlace())) { savePref('ple-data-acct', ''); location.reload(); }
  else setTimeout(() => toast(`${dataPlace()}의 할 일·가계부를 보고 있어요`), 600);
}
sync.startSync();
renderSyncPill();
