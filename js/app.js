// 담다(Damda) 진입점: 화면 전환(☰ 메뉴), 제목, 테마, 동기화 메뉴, 단축키, PWA 서비스 워커 등록.
import { migrateCategories } from './categories.js';
import { store } from './store.js';
import { purgeSamples } from './sample.js';
import { runRecurring } from './recurring.js';
import { closeOverlay, toggleOverlay, closeOnBackdrop, topOverlay, isOpen } from './ui/overlay.js';
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
  tab = next;
  savePref('ple-tab', tab);
  for (const name of Object.keys(SCREENS)) document.getElementById(`view-${name}`).hidden = name !== tab;
  const s = SCREENS[tab];
  titleEl.textContent = s.label;
  document.title = `${s.label} · 담다`;
  if (tab !== 'calendar' && dayPanel.isPanelOpen()) closeOverlay(document.getElementById('dayPanel'));
  s.view.render();
}

// 데이터가 바뀌면 보이는 화면만 다시 그린다
store.subscribe(() => {
  SCREENS[tab].view.render();
  dayPanel.render();
});
window.addEventListener('ple:panelchange', () => { if (tab === 'calendar') calendar.render(); });

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

// ---- ☰ 메뉴 (왼쪽에서 열리는 서랍): 화면 · 동기화 · 설정 ----
const menu = document.getElementById('menuModal');
menu.classList.add('side-wrap');
const syncPill = document.getElementById('syncPill');

const SYNC_MODES = [
  { key: 'local', title: '이 기기에만', desc: '인터넷 없이 이 기기에만 저장해요. 다른 기기와 맞추지 않아요.' },
  { key: 'auto', title: '자동 동기화', desc: '저장하면 1초 안에 올리고, 화면을 보는 동안 5초마다 맞춰요.', badge: '추천' },
  { key: 'saver', title: '절약 모드', desc: '앱을 열 때와 돌아올 때만 맞춰요. 배터리와 데이터를 아껴요.' },
  { key: 'manual', title: '직접', desc: '[지금 맞추기]를 누를 때만 맞춰요.' },
];

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
  const mode = sync.syncMode();
  const st = sync.getStatus();
  let state = 'local';
  let text = '이 기기에 저장';
  let sub = ''; // 좁은 화면에서는 숨기는 덧붙임 (예: "· 3분 전")
  if (mode !== 'local' && !sync.isConnected()) { state = 'waiting'; text = '구글 연결 대기'; }
  else if (mode !== 'local') {
    if (st.phase === 'syncing') { state = 'syncing'; text = '맞추는 중…'; }
    else if (st.phase === 'need-login') { state = 'waiting'; text = '다시 로그인 필요'; }
    else if (st.phase === 'error') { state = 'error'; text = '동기화 오류'; }
    else { state = 'on'; text = st.lastSync ? '동기화됨' : '동기화 켜짐'; sub = st.lastSync ? ` · ${ago(st.lastSync)}` : ''; }
  }
  syncPill.dataset.state = state;
  // 좁은 화면에서는 앞말을 빼고 짧게: "구글 연결 대기" → "연결 대기"
  const SHORT_PREFIX = { '구글 연결 대기': '구글 ', '다시 로그인 필요': '다시 ', '이 기기에 저장': '이 ' };
  const pre = SHORT_PREFIX[text] || '';
  syncPill.lastElementChild.innerHTML = `${pre ? `<span class="pill-pre">${pre}</span>` : ''}${escapeHtml(text.slice(pre.length))}${sub ? `<span class="pill-sub">${escapeHtml(sub)}</span>` : ''}`;
}

function syncCardHtml() {
  const mode = sync.syncMode();
  const acc = sync.account();
  const st = sync.getStatus();
  const configured = isConfigured();
  let statusLine;
  if (!acc) statusLine = '<span class="sync-dot"></span>구글 계정이 연결되지 않았어요';
  else if (st.phase === 'need-login') statusLine = '<span class="sync-dot warn"></span>로그인이 만료됐어요. 다시 로그인하면 이어서 맞춰요';
  else if (st.phase === 'error') statusLine = `<span class="sync-dot err"></span>${escapeHtml(st.message)}`;
  else statusLine = `<span class="sync-dot ok"></span>${escapeHtml(acc.email || '구글 계정')}${st.lastSync ? ` · ${ago(st.lastSync)} 맞춤` : ''}`;

  return `
    <div class="sync-card">
      <div class="sync-status">${statusLine}</div>
      ${!acc ? `
        <button type="button" class="google-btn" data-act="google-connect">
          <span class="g-mark" aria-hidden="true">G</span> 구글 계정으로 연결
          ${configured ? '' : '<span class="soon">설정 필요</span>'}
        </button>` : `
        <div class="google-actions">
          ${st.phase === 'need-login' ? '<button type="button" class="google-btn" data-act="google-reconnect"><span class="g-mark" aria-hidden="true">G</span> 다시 로그인</button>' : ''}
          ${mode !== 'local' ? `<button type="button" class="pill-btn" data-act="sync-now"${st.phase === 'syncing' ? ' disabled' : ''}>${st.phase === 'syncing' ? '맞추는 중…' : '지금 맞추기'}</button>` : ''}
          <button type="button" class="pill-btn danger-text" data-act="google-disconnect">연결 끊기</button>
        </div>`}
      <div class="sync-modes" role="radiogroup" aria-label="동기화 방식">
        ${SYNC_MODES.map(m => `
          <button type="button" class="sync-mode${m.key === mode ? ' on' : ''}" data-mode="${m.key}" role="radio" aria-checked="${m.key === mode}">
            <span class="radio" aria-hidden="true"></span>
            <span class="sync-text">
              <strong>${m.title}${m.badge ? ` <em>${m.badge}</em>` : ''}</strong>
              <span class="muted small">${m.desc}</span>
            </span>
          </button>`).join('')}
      </div>
      ${mode !== 'local' && !acc ? '<p class="sync-note">구글 계정을 연결하면 이 방식으로 맞춰요.</p>' : ''}
      <p class="muted small sync-foot">데이터는 내 구글 드라이브의 <b>앱 전용 숨김 폴더</b>에만 저장돼요. 다른 드라이브 파일은 보지 않아요. 구글이 보관하므로 따로 백업하지 않아도 돼요.</p>
    </div>`;
}

// 설정: 기기마다 따로. 소리는 없음(알림은 폰 기본 알림음), PC는 진동도 없음
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
  return `
    <div class="set-card">
      ${touch ? switchRow('vibrate', '📳', '진동', '꾹 누르기·옮기기 같은 손끝 반응') : ''}
      ${switchRow('notify', '🔔', '알림', touch ? '일정·반복 할 일 알림 · 소리는 폰 기본 알림음' : '일정 알림 · PC는 구글 캘린더가 알려줘요')}
      <p class="muted small set-foot">알림은 ${touch ? '갤럭시 앱' : '구글 캘린더 연결'}부터 울려요. ${touch ? '' : 'PC에는 소리·진동이 없어요. '}설정은 이 기기에만 적용돼요.</p>
    </div>`;
}

// ☰ 메뉴: 구글 캘린더 (서로 추가·수정·삭제, 여러 계정)
const ACCT_STATE = { ok: '', 'read-only': '보기만', 'need-login': '다시 로그인 필요', 'need-scope': '권한 필요', error: '오류' };

function gcalCardHtml() {
  if (!sync.account()) {
    return '<div class="sync-card"><p class="muted small gcal-note">구글 계정을 먼저 연결하면, 폰(삼성·구글·노션) 캘린더 일정과 담다 일정이 서로 맞춰져요.</p></div>';
  }
  if (!gcal.isEnabled()) {
    return `
      <div class="sync-card">
        <button type="button" class="google-btn" data-act="gcal-connect"><span class="g-mark cal" aria-hidden="true">📅</span> 구글 캘린더 연결</button>
        <p class="muted small gcal-note">폰 캘린더와 담다의 <b>일정</b>이 서로 추가·수정·삭제돼요. 할 일과 가계부는 담다에만 있어요.</p>
      </div>`;
  }
  const st = gcal.getStatus();
  const cals = gcal.calendars();
  const writable = gcal.writableCalendars();
  const target = gcal.target();
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
        <button type="button" class="google-btn" data-act="gcal-connect"><span class="g-mark cal" aria-hidden="true">📅</span> ${mainState === 'read-only' ? '일정 수정도 허락하기' : '다시 연결 (캘린더 권한 체크)'}</button>` : ''}
      ${gcal.accounts().map(a => {
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
      }).join('')}
      <button type="button" class="pill-btn wide" data-act="gcal-add-account">＋ 다른 구글 계정 캘린더 추가</button>
      ${writable.length ? `
        <label class="gcal-target">새 일정 저장
          <select data-gcal-target>
            ${writable.map(c => `<option value="${escapeHtml(`${c.acct}|${c.id}`)}"${target && target.acct === c.acct && target.id === c.id ? ' selected' : ''}>${escapeHtml(c.name)}${c.acct === 'main' ? '' : ` (${escapeHtml(c.accountEmail)})`}</option>`).join('')}
          </select>
        </label>` : ''}
      <div class="google-actions">
        <button type="button" class="pill-btn" data-act="gcal-refresh"${st.phase === 'loading' ? ' disabled' : ''}>지금 맞추기</button>
        <button type="button" class="pill-btn danger-text" data-act="gcal-disconnect">캘린더 연결 끊기</button>
      </div>
      <p class="muted small sync-foot">구글 계정에 저장된 일정만 맞춰요 (삼성 캘린더의 "내 휴대전화"·"삼성 계정" 일정은 제외). 반복 일정·공휴일·남이 공유한 캘린더는 보기만 해요. 추가 계정은 구글 클라우드의 테스트 사용자로 등록되어 있어야 해요.</p>
    </div>`;
}

// 담다에만 있던 일정을 구글 캘린더로 옮길지 한 번 묻는다
async function askMigrateEvents() {
  if (!gcal.canWrite() || loadPref('ple-gcal-migrate-asked', false)) return;
  const local = store.list('events');
  if (!local.length) return;
  const t = gcal.target();
  const v = await choiceDialog({
    title: '일정을 구글 캘린더로 옮길까요?',
    message: `담다에만 있던 일정 ${local.length}개를 구글 캘린더(${t.name})로 옮기면 폰 캘린더에서도 보여요. 옮긴 뒤 담다 쪽 사본은 지워져요.`,
    cancelLabel: '그대로 두기',
    choices: [{ label: '옮기기', value: 'yes' }],
  });
  savePref('ple-gcal-migrate-asked', true);
  if (v !== 'yes') return;
  await gcal.migrateLocal(local);
  store.batch(() => local.forEach(e => store.remove('events', e.id)));
  toast(`일정 ${local.length}개를 구글 캘린더로 옮겼어요`);
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
      ${settingsHtml()}
    </div>`;
}

sync.onStatus(() => {
  renderSyncPill();
  const slot = menu.querySelector('.sync-slot');
  if (slot && isOpen(menu)) slot.innerHTML = syncCardHtml();
  const cal = menu.querySelector('.gcal-slot');
  if (cal && isOpen(menu)) cal.innerHTML = gcalCardHtml();
});
menu.addEventListener('change', e => {
  const sel = e.target.closest('[data-gcal-target]');
  if (!sel) return;
  const [acct, ...rest] = sel.value.split('|');
  gcal.setTarget(acct, rest.join('|'));
  toast('새 일정은 이 캘린더에 저장돼요');
});
window.addEventListener('ple:gcal-notice', e => toast(e.detail));
// 구글 캘린더 일정이 바뀌면 달력·날짜 패널·메뉴를 다시 그린다
gcal.subscribe(() => {
  SCREENS[tab].view.render();
  dayPanel.render();
  const cal = menu.querySelector('.gcal-slot');
  if (cal && isOpen(menu)) cal.innerHTML = gcalCardHtml();
});
setInterval(renderSyncPill, 30 * 1000); // "3분 전" 같은 표시 갱신

closeOnBackdrop(menu);
const openMenu = () => { renderMenu(); toggleOverlay({ el: menu }); };
document.getElementById('menuBtn').addEventListener('click', openMenu);
syncPill.addEventListener('click', openMenu);

const SETUP_GUIDE = '구글 연결을 쓰려면 먼저 구글 클라우드에서 이 앱을 등록하고, 받은 "클라이언트 ID"를 js/config.js에 넣어야 해요. 등록 방법은 채팅에서 단계별로 안내받을 수 있어요. (무료, 약 10분)';

menu.addEventListener('click', async e => {
  if (e.target.closest('[data-close]')) return closeOverlay(menu);
  const screen = e.target.closest('[data-screen]');
  if (screen) { closeOverlay(menu); return showTab(screen.dataset.screen); }
  const set = e.target.closest('[data-set]');
  if (set) {
    const key = set.dataset.set;
    const on = !getSetting(key);
    setSetting(key, on);
    if (key === 'vibrate' && on) buzz(15);
    set.setAttribute('aria-checked', on);
    set.querySelector('.switch').classList.toggle('on', on);
    return;
  }
  const calRow = e.target.closest('[data-gcal-cal]');
  if (calRow) { gcal.toggleCalendar(calRow.dataset.gcalAcct, calRow.dataset.gcalCal); return; }
  const m = e.target.closest('[data-mode]');
  if (m) { sync.setSyncMode(m.dataset.mode); renderMenu(); renderSyncPill(); return; }

  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  try {
    if (act === 'google-connect') {
      if (!isConfigured()) return choiceDialog({ title: '구글 연결 준비', message: SETUP_GUIDE, cancelLabel: '알겠어요', choices: [] });
      gcal.prepareConnect(); // 한 번에: 드라이브(할 일·가계부) + 캘린더(일정)
      const email = await sync.connectGoogle();
      const cal = gcal.afterConnect();
      toast(`${email || '구글 계정'}과 연결했어요${cal ? ' · 캘린더도 함께' : ''}`);
      if (cal) setTimeout(askMigrateEvents, 1500);
    }
    if (act === 'google-reconnect') { await sync.reconnectGoogle(); toast('다시 로그인했어요'); }
    if (act === 'sync-now') await sync.syncNow();
    if (act === 'gcal-connect') {
      const r = await gcal.connectCalendar(sync.account()?.email || '');
      toast(r.canWrite ? `구글 캘린더 ${r.shown}개를 연결했어요 · 서로 수정돼요` : `구글 캘린더 ${r.shown}개를 연결했어요 · 보기만`);
      if (r.canWrite) setTimeout(askMigrateEvents, 800);
    }
    if (act === 'gcal-add-account') {
      const email = await gcal.addAccount();
      toast(`${email} 캘린더를 추가했어요`);
    }
    if (act === 'gcal-relogin') await gcal.reloginAccount(e.target.closest('[data-email]').dataset.email);
    if (act === 'gcal-remove') {
      const email = e.target.closest('[data-email]').dataset.email;
      const v = await choiceDialog({
        title: '계정 빼기',
        message: `${email}의 캘린더가 담다에서 보이지 않게 돼요. 그 계정의 구글 캘린더 일정은 그대로예요.`,
        choices: [{ label: '빼기', value: 'yes', danger: true }],
      });
      if (v !== 'yes') return;
      await gcal.removeAccount(email);
      toast('계정을 뺐어요');
    }
    if (act === 'gcal-refresh') await gcal.refresh();
    if (act === 'gcal-disconnect') {
      const v = await choiceDialog({
        title: '구글 캘린더 연결 끊기',
        message: '담다에서 구글 캘린더 일정이 보이지 않게 돼요. 구글 캘린더의 일정은 그대로예요.',
        choices: [{ label: '연결 끊기', value: 'yes', danger: true }],
      });
      if (v !== 'yes') return;
      await gcal.disconnectCalendar();
      toast('구글 캘린더 연결을 끊었어요');
    }
    if (act === 'google-disconnect') {
      const v = await choiceDialog({
        title: '구글 연결 끊기',
        message: '이 기기의 기록은 그대로 남고, 구글과 맞추는 것만 멈춰요. 구글 드라이브에 있는 데이터도 지워지지 않아요.',
        choices: [{ label: '연결 끊기', value: 'yes', danger: true }],
      });
      if (v !== 'yes') return;
      sync.disconnectGoogle();
      await gcal.disconnectCalendar();
      toast('구글 연결을 끊었어요');
    }
  } catch (err) {
    toast(err.message || '구글과 연결하지 못했어요');
  }
  renderMenu();
  renderSyncPill();
});

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

showTab(tab);
recordRecurring();
sync.startSync();
renderSyncPill();
