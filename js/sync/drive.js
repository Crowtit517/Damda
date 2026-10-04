// 구글 드라이브 '앱 전용 숨김 폴더'(appDataFolder)에 데이터 파일 하나를 읽고 쓴다.
// 이 폴더는 이 앱만 볼 수 있고, 사용자의 다른 드라이브 파일에는 접근하지 않는다.
import { getDriveToken, invalidateDriveToken, NeedLogin } from './google.js';
import { DRIVE_FILE_NAME } from '../config.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const META = 'id,version,modifiedTime';

// token을 주면 그 토큰으로 (할 일·가계부 담는 곳을 바꿀 때 새 계정을 미리 살펴보는 용도)
async function call(url, opts = {}, token = null) {
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token || getDriveToken()}` } });
  if (r.status === 401) { if (!token) invalidateDriveToken(); throw new NeedLogin(); }
  if (!r.ok) throw new Error(`구글 드라이브와 통신하지 못했어요 (${r.status})`);
  return r;
}

/** 데이터 파일 찾기 (없으면 null) */
export async function findFile(token = null) {
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const r = await call(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(${META})&orderBy=modifiedTime desc`, {}, token);
  return (await r.json()).files?.[0] || null;
}

/** 파일 버전만 가볍게 확인 (바뀌었는지 보려고) */
export async function getMeta(id) {
  try {
    const r = await call(`${API}/files/${id}?fields=${META}`);
    return await r.json();
  } catch (err) {
    if (err instanceof NeedLogin) throw err;
    return null; // 파일이 지워졌으면 새로 찾는다
  }
}

export async function download(id) {
  const r = await call(`${API}/files/${id}?alt=media`);
  return r.json();
}

export async function create(data, token = null) {
  const boundary = 'damda' + Math.random().toString(36).slice(2);
  const body = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '',
    JSON.stringify({ name: DRIVE_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' }),
    `--${boundary}`, 'Content-Type: application/json', '',
    JSON.stringify(data), `--${boundary}--`, '',
  ].join('\r\n');
  const r = await call(`${UPLOAD}/files?uploadType=multipart&fields=${META}`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  }, token);
  return r.json();
}

export async function update(id, data) {
  const r = await call(`${UPLOAD}/files/${id}?uploadType=media&fields=${META}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  return r.json();
}
