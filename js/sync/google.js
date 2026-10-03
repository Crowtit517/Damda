// 구글 로그인 (Google Identity Services, 토큰 방식).
// 서버가 없으므로 접근 토큰은 이 기기 메모리에만 두고, 약 1시간 뒤 만료되면 다시 받는다.
// 권한: 드라이브의 '앱 전용 숨김 폴더'만(drive.appdata) + 어떤 계정인지 보여주기 위한 이메일.
import { GOOGLE_CLIENT_ID } from '../config.js';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

let token = null;
let tokenExp = 0;
let gisLoading = null;

export class NeedLogin extends Error {
  constructor() { super('구글 로그인이 필요해요'); }
}

export const isConfigured = () => !!GOOGLE_CLIENT_ID;
export const hasToken = () => !!token && Date.now() < tokenExp;
export const clearToken = () => { token = null; tokenExp = 0; };

function loadGis() {
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
