// PC 앱 구글 로그인: 기본 브라우저(크롬)에서 로그인하고 PC 앱으로 돌아온다 (구글의 '데스크톱 앱' 방식, PKCE).
// 구글은 앱 안에 넣은 브라우저에서의 로그인을 막기 때문에, 로그인만 진짜 브라우저에서 한다.
// - 처음: 브라우저 로그인 → '다시 받기 권한(refresh token)'을 Windows 암호화(DPAPI, safeStorage)로 이 PC에 보관
// - 다음부터: 브라우저 없이 조용히 새 접근 토큰을 받는다 (로그인이 계속 유지된다)
// - 설정: desktop/oauth.local.json (구글 클라우드 콘솔의 '데스크톱 앱' 클라이언트. git에는 올리지 않는다)
const { app, safeStorage, shell, net } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 시험할 때만: 가짜 구글 서버 주소 (DAMDA_OAUTH_TEST=http://127.0.0.1:포트)
const TEST = process.env.DAMDA_OAUTH_TEST || '';
const AUTH_URL = TEST ? `${TEST}/auth` : 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = TEST ? `${TEST}/token` : 'https://oauth2.googleapis.com/token';
const REVOKE_URL = TEST ? `${TEST}/revoke` : 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = TEST ? `${TEST}/userinfo` : 'https://www.googleapis.com/oauth2/v3/userinfo';
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const LOGIN_TIMEOUT = 5 * 60 * 1000;

const accountsFile = () => path.join(app.getPath('userData'), 'google-accounts.json');

function loadClient() {
  if (TEST) return { client_id: 'test-client', client_secret: 'test-secret' };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'oauth.local.json'), 'utf8'));
    const c = j.installed || j; // 콘솔에서 내려받은 파일 그대로여도 된다
    if (c.client_id && c.client_secret) return { client_id: c.client_id, client_secret: c.client_secret };
  } catch {}
  return null;
}

// ---- 보관: { 이메일: { rt: 암호화한 refresh token(base64), scope } } ----
function loadAccounts() { try { return JSON.parse(fs.readFileSync(accountsFile(), 'utf8')); } catch { return {}; } }
function saveAccounts(a) { try { fs.writeFileSync(accountsFile(), JSON.stringify(a)); } catch {} }
const seal = s => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString('base64') : null);
const unseal = b => safeStorage.decryptString(Buffer.from(b, 'base64'));

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const scopeList = s => (s || '').split(/\s+/).filter(Boolean);
const toResult = (data, email, fallbackScope) => ({
  token: data.access_token,
  exp: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000,
  scope: data.scope || fallbackScope || '',
  email,
});

async function postForm(url, params) {
  const res = await net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error_description || data.error || `HTTP ${res.status}`); e.code = data.error; throw e; }
  return data;
}

async function refresh(client, email, acc) {
  const data = await postForm(TOKEN_URL, { client_id: client.client_id, client_secret: client.client_secret, refresh_token: unseal(acc.rt), grant_type: 'refresh_token' });
  return toResult(data, email, acc.scope);
}

// 브라우저 로그인 하나만 진행 (새로 시작하면 이전 것은 취소)
let pending = null;

function browserLogin(client, { scopes, hint, prompt }, onDone) {
  pending?.cancel('새 로그인을 시작했어요.');
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    let timer = null, finished = false;
    const server = http.createServer();
    const end = (err, val) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      setTimeout(() => server.close(), 500);
      if (pending?.state === state) pending = null;
      onDone?.();
      err ? reject(err) : resolve(val);
    };
    pending = { state, cancel: msg => end(new Error(msg)) };

    server.on('request', async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404); return res.end(); }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(donePage(ok ? '로그인했어요' : '로그인하지 못했어요', ok ? '이 창을 닫고 담다로 돌아가세요.' : '담다로 돌아가서 다시 시도해 주세요.', ok));
      if (u.searchParams.get('error')) return end(new Error(u.searchParams.get('error') === 'access_denied' ? '로그인을 취소했어요.' : '구글 로그인을 하지 못했어요.'));
      if (!ok) return end(new Error('구글 로그인을 하지 못했어요.'));
      try {
        const redirect_uri = `http://127.0.0.1:${server.address().port}`;
        const data = await postForm(TOKEN_URL, {
          code: u.searchParams.get('code'), client_id: client.client_id, client_secret: client.client_secret,
          redirect_uri, grant_type: 'authorization_code', code_verifier: verifier,
        });
        // 어느 계정으로 로그인했는지
        const info = await net.fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${data.access_token}` } }).then(r => r.json()).catch(() => ({}));
        const email = info.email || hint || '';
        if (data.refresh_token && email) {
          const rt = seal(data.refresh_token);
          if (rt) { const a = loadAccounts(); a[email] = { rt, scope: data.scope || scopes.join(' ') }; saveAccounts(a); }
        }
        end(null, toResult(data, email, scopes.join(' ')));
      } catch (e) { end(new Error('구글 로그인을 마치지 못했어요. 다시 시도해 주세요.')); }
    });

    server.listen(0, '127.0.0.1', () => {
      const redirect_uri = `http://127.0.0.1:${server.address().port}`;
      const q = new URLSearchParams({
        client_id: client.client_id, redirect_uri, response_type: 'code',
        scope: [...new Set([...scopes, EMAIL_SCOPE])].join(' '),
        include_granted_scopes: 'true', access_type: 'offline',
        // 다시 받기 권한을 확실히 받으려면 동의 화면을 거쳐야 한다. 계정 추가는 계정 고르기부터
        prompt: prompt === 'select_account' ? 'select_account consent' : 'consent',
        code_challenge: challenge, code_challenge_method: 'S256', state,
      });
      if (hint) q.set('login_hint', hint);
      const url = `${AUTH_URL}?${q}`;
      // 시험할 때는 브라우저 대신 직접 따라간다 (가짜 서버가 바로 돌아오는 주소로 보낸다)
      (TEST ? net.fetch(url).then(() => {}) : shell.openExternal(url)).catch(() => end(new Error('브라우저를 열지 못했어요.')));
    });
    timer = setTimeout(() => end(new Error('로그인 시간이 지났어요. 다시 시도해 주세요.')), LOGIN_TIMEOUT);
  });
}

function donePage(title, msg, ok) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>담다 · ${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:'Malgun Gothic',sans-serif;background:linear-gradient(160deg,#6b74c9,#7a5aa8);color:#fff}
.c{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);border-radius:24px;padding:36px 44px;text-align:center}
h1{margin:0 0 10px;font-size:28px}p{margin:0;opacity:.9}</style></head>
<body><div class="c"><h1>${ok ? '✓ ' : ''}${title}</h1><p>${msg}</p></div><script>setTimeout(() => window.close(), 1500)</script></body></html>`;
}

/**
 * 토큰 받기. 보관된 다시 받기 권한이 있고 요청 권한이 그 안에 들어 있으면 브라우저 없이,
 * 아니면 브라우저 로그인. 반환: { token, exp, scope, email }
 */
async function getToken({ scopes = [], hint = '', prompt = '', silent = false } = {}, onBrowserDone) {
  const client = loadClient();
  if (!client) throw new Error('PC 앱 구글 로그인 설정(desktop/oauth.local.json)이 아직 없어요.');
  const accounts = loadAccounts();
  const acc = hint && accounts[hint];
  if (acc && prompt !== 'select_account' && prompt !== 'consent' && scopes.every(s => scopeList(acc.scope).includes(s))) {
    try { return await refresh(client, hint, acc); }
    catch (e) { if (e.code === 'invalid_grant') { delete accounts[hint]; saveAccounts(accounts); } else throw new Error('구글에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  }
  if (silent) throw new Error('다시 로그인이 필요해요.'); // 조용히만 시도: 브라우저는 열지 않는다
  return browserLogin(client, { scopes, hint, prompt }, onBrowserDone);
}

/** 이 PC에 보관한 다시 받기 권한을 지운다 (email 없으면 전부). 구글에도 권한을 돌려준다 */
async function forget(email) {
  const accounts = loadAccounts();
  for (const e of email ? [email] : Object.keys(accounts)) {
    const acc = accounts[e];
    if (!acc) continue;
    try { await postForm(REVOKE_URL, { token: unseal(acc.rt) }); } catch {}
    delete accounts[e];
  }
  saveAccounts(accounts);
}

const savedAccounts = () => Object.keys(loadAccounts());

module.exports = { getToken, forget, savedAccounts, isConfigured: () => !!loadClient() };
