// 구글 로그인 (Google Identity Services, 토큰 방식).
// 서버가 없으므로 '다시 받기 권한(refresh token)'은 받을 수 없다. 약 1시간짜리 접근 토큰만 받고,
// 새로고침해도 끊기지 않게 남은 시간 동안만 이 기기에 보관한다 (연결 끊기·만료 시 지움).
// 기본 권한: 드라이브의 '앱 전용 숨김 폴더'만(drive.appdata) + 어떤 계정인지 보여주기 위한 이메일.
// 추가 권한(예: 캘린더 보기)은 사용자가 켰을 때만 함께 요청하고, 다시 로그인할 때도 계속 요청한다.
// PC 앱(desktop/)에서는 로그인을 기본 브라우저에서 하고, 다시 받기 권한을 PC 앱이 보관해 조용히 새 토큰을 받는다
// (앱 안 로그인 창은 구글이 막는다). 갤럭시 앱(mobile/)은 폰에 로그인된 구글 계정으로 받는다(구글 플레이 서비스가 갱신).
// 이 파일의 나머지 동작은 웹과 같다.
import { GOOGLE_CLIENT_ID } from '../config.js';
import { isDesk } from '../desk.js';
import { isNative, plugin } from '../native.js';

/** 앱(PC·갤럭시)이 로그인을 맡는지. 그러면 만료돼도 창 없이 바로 다시 받을 수 있다 */
export const appLogin = isDesk || isNative;

const BASE_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.email',
];
export const CAL_READ = 'https://www.googleapis.com/auth/calendar.readonly';
export const CAL_WRITE = 'https://www.googleapis.com/auth/calendar.events';
export const CAL_SCOPES = [CAL_READ, CAL_WRITE];
export const DRIVE_SCOPE = BASE_SCOPES[0];

const TOKEN_KEY = 'ple-gtoken';
const EXTRA_KEY = 'ple-gscopes'; // 사용자가 켠 추가 권한 목록
let token = null;
let tokenExp = 0;
let grantedScope = ''; // 구글이 실제로 허락한 권한 (사용자가 체크를 풀 수도 있다)
let gisLoading = null;

// 보관해 둔 토큰이 아직 유효하면 이어서 쓴다
try {
  const saved = JSON.parse(localStorage.getItem(TOKEN_KEY));
  if (saved?.token && saved.exp > Date.now()) { token = saved.token; tokenExp = saved.exp; grantedScope = saved.scope || ''; }
  else localStorage.removeItem(TOKEN_KEY);
} catch {}

function keepToken() {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: tokenExp, scope: grantedScope })); } catch {}
}

function extraScopes() {
  try { const v = JSON.parse(localStorage.getItem(EXTRA_KEY)); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function wantScope(scope, on) {
  const set = new Set(extraScopes());
  if (on) set.add(scope); else set.delete(scope);
  try { localStorage.setItem(EXTRA_KEY, JSON.stringify([...set])); } catch {}
}
/** 지금 토큰에 이 권한이 들어 있나 */
export const hasScope = scope => hasToken() && grantedScope.split(' ').includes(scope);

export class NeedLogin extends Error {
  constructor() { super('구글 로그인이 필요해요'); }
}

export const isConfigured = () => appLogin || !!GOOGLE_CLIENT_ID;
export const hasToken = () => !!token && Date.now() < tokenExp;
export const clearToken = () => {
  token = null;
  tokenExp = 0;
  grantedScope = '';
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
};

/** 구글 로그인 도구를 미리 불러 둔다 (다시 로그인 창이 바로 뜨도록) */
export function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisLoading = null; reject(new Error('구글 로그인 도구를 불러오지 못했어요. 인터넷 연결을 확인해주세요.')); };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

const popupError = e => new Error(e?.type === 'popup_closed' ? '로그인 창이 닫혔어요.' : e?.type === 'popup_failed_to_open' ? '로그인 창이 막혔어요. 팝업을 허용해주세요.' : '구글 로그인을 하지 못했어요.');

/** 토큰 하나 받기 (기본 계정·추가 계정 공용). 버튼을 누른 직후(사용자 동작 안)에서 불러야 팝업이 막히지 않는다 */
export async function requestToken({ scopes, hint = '', prompt = '', silent = false }) {
  // PC 앱: 보관된 권한이 있으면 창 없이, 없으면 기본 브라우저에서 로그인 → { token, exp, scope, email }
  // silent: 창 없이만 시도 (안 되면 브라우저를 열지 않고 실패)
  if (isDesk) return window.desk.googleToken({ scopes, hint, prompt, silent });
  // 갤럭시 앱: 폰의 구글 계정으로 (처음·권한 추가 때만 동의 화면)
  if (isNative) {
    try { return await plugin('DamdaGoogle').token({ scopes, hint, prompt, silent }); }
    catch (e) { throw new Error(e?.message || '구글 로그인을 하지 못했어요.'); }
  }
  if (!isConfigured()) throw new Error('구글 연결 설정(클라이언트 ID)이 아직 없어요.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: scopes.join(' '),
      include_granted_scopes: true,
      callback: r => {
        if (r.error) return reject(new Error('구글 로그인을 하지 못했어요.'));
        resolve({ token: r.access_token, exp: Date.now() + (Number(r.expires_in || 3600) - 60) * 1000, scope: r.scope || '' });
      },
      error_callback: e => reject(popupError(e)),
    });
    client.requestAccessToken({ prompt, login_hint: hint || undefined });
  });
}

/** 기본 계정(드라이브 동기화 계정) 로그인 */
export async function signIn(hintEmail = '', { silent = false } = {}) {
  const t = await requestToken({ scopes: [...BASE_SCOPES, ...extraScopes()], hint: hintEmail, silent });
  token = t.token;
  tokenExp = t.exp;
  grantedScope = t.scope;
  keepToken();
  if (appLogin) scheduleDeskRefresh(t.email || hintEmail);
  window.dispatchEvent(new Event('ple:google-signin'));
  return token;
}

// 앱(PC·갤럭시): 기본 계정 토큰이 끝나기 5분 전에 창 없이 새로 받아 둔다 (로그인이 끊기지 않게)
let deskTimer = null;
function scheduleDeskRefresh(email) {
  clearTimeout(deskTimer);
  if (!email) return;
  deskTimer = setTimeout(async () => {
    try {
      const t = await requestToken({ scopes: [...BASE_SCOPES, ...extraScopes()], hint: email, silent: true });
      token = t.token; tokenExp = t.exp; grantedScope = t.scope;
      keepToken();
      scheduleDeskRefresh(email);
    } catch {}
  }, Math.max(60000, tokenExp - Date.now() - 5 * 60000));
}

/** 앱: 그 계정의 로그인 권한을 지운다 (계정 빼기·연결 끊기). PC는 보관한 권한 삭제, 갤럭시는 구글에 권한을 돌려준다 */
export function forgetAccount(email, accessToken = '') {
  if (isDesk) window.desk.googleForget(email);
  if (isNative && accessToken) revokeOnGoogle(accessToken);
}
const revokeOnGoogle = t => fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${encodeURIComponent(t)}` }).catch(() => {});

// 할 일·가계부를 담는 곳이 추가 계정이면, 드라이브는 그 계정의 토큰을 쓴다 (gcal.js가 정해 준다)
let driveProvider = null; // { get(): 토큰|null, invalidate(), relogin(): Promise }
export function setDriveProvider(p) { driveProvider = p; }
export const hasDriveToken = () => (driveProvider ? !!driveProvider.get() : hasToken());
export function getDriveToken() {
  if (!driveProvider) return getToken();
  const t = driveProvider.get();
  if (!t) throw new NeedLogin();
  return t;
}
export function invalidateDriveToken() {
  if (driveProvider) driveProvider.invalidate();
  else clearToken();
}
/** 드라이브 계정 다시 로그인 (추가 계정이면 그 계정으로). 없으면 null */
export const driveRelogin = opts => driveProvider?.relogin?.(opts) || null;

export function getToken() {
  if (!hasToken()) throw new NeedLogin();
  return token;
}

export async function fetchEmail() {
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) throw new Error('계정 정보를 읽지 못했어요.');
  return (await r.json()).email || '';
}

export function signOut() {
  try { if (token) window.google?.accounts?.oauth2?.revoke(token, () => {}); } catch {}
  clearTimeout(deskTimer);
  if (isDesk) window.desk.googleForget(''); // PC 앱: 보관한 로그인 권한을 모두 지운다
  if (isNative && token) revokeOnGoogle(token); // 갤럭시 앱: 구글에 권한을 돌려준다
  clearToken();
}
