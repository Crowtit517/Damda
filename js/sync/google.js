// 구글 로그인 (Google Identity Services, 토큰 방식).
// 서버가 없으므로 '다시 받기 권한(refresh token)'은 받을 수 없다. 약 1시간짜리 접근 토큰만 받고,
// 새로고침해도 끊기지 않게 남은 시간 동안만 이 기기에 보관한다 (연결 끊기·만료 시 지움).
// 권한: 드라이브의 '앱 전용 숨김 폴더'만(drive.appdata) + 어떤 계정인지 보여주기 위한 이메일.
import { GOOGLE_CLIENT_ID } from '../config.js';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const TOKEN_KEY = 'ple-gtoken';
let token = null;
let tokenExp = 0;
let gisLoading = null;

// 보관해 둔 토큰이 아직 유효하면 이어서 쓴다
try {
  const saved = JSON.parse(localStorage.getItem(TOKEN_KEY));
  if (saved?.token && saved.exp > Date.now()) { token = saved.token; tokenExp = saved.exp; }
  else localStorage.removeItem(TOKEN_KEY);
} catch {}

function keepToken() {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: tokenExp })); } catch {}
}

export class NeedLogin extends Error {
  constructor() { super('구글 로그인이 필요해요'); }
}

export const isConfigured = () => !!GOOGLE_CLIENT_ID;
export const hasToken = () => !!token && Date.now() < tokenExp;
export const clearToken = () => {
  token = null;
  tokenExp = 0;
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

/** 로그인 창을 띄워 토큰을 받는다. 버튼을 누른 직후(사용자 동작 안)에서 불러야 팝업이 막히지 않는다 */
export async function signIn(hintEmail = '') {
  if (!isConfigured()) throw new Error('구글 연결 설정(클라이언트 ID)이 아직 없어요.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: r => {
        if (r.error) return reject(new Error('구글 로그인을 하지 못했어요.'));
        token = r.access_token;
        tokenExp = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000;
        keepToken();
        resolve(token);
      },
      error_callback: e => reject(new Error(e?.type === 'popup_closed' ? '로그인 창이 닫혔어요.' : e?.type === 'popup_failed_to_open' ? '로그인 창이 막혔어요. 팝업을 허용해주세요.' : '구글 로그인을 하지 못했어요.')),
    });
    client.requestAccessToken({ prompt: '', login_hint: hintEmail || undefined });
  });
}

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
  clearToken();
}
