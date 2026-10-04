// PC 앱 구글 로그인(기본 브라우저 + PKCE + 다시 받기 권한) 시험.
// 가짜 구글 서버(7777)를 띄우고, PC 앱을 DAMDA_OAUTH_TEST 로 켜서 전체 흐름을 확인한다.
// 실행: node test/desk_login_test.mjs  (desktop/node_modules 필요, 개발 모드로 앱을 직접 켠다)
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import { spawn, execSync } from 'child_process';

const PORT = 7777, DBG = 9334;
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fake = { codes: {}, rts: {}, revoked: new Set(), auth: 0, refresh: 0, lastAuth: null, n: 0 };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const body = await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(new URLSearchParams(d))); });
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (u.pathname === '/auth') {
    fake.auth++;
    const q = Object.fromEntries(u.searchParams);
    fake.lastAuth = q;
    const ok = q.client_id === 'test-client' && q.response_type === 'code' && q.code_challenge_method === 'S256' && q.code_challenge && /^http:\/\/127\.0\.0\.1:\d+$/.test(q.redirect_uri) && q.access_type === 'offline';
    if (!ok || q.login_hint === 'deny@x.com') { res.writeHead(302, { Location: `${q.redirect_uri}?error=access_denied&state=${q.state}` }); return res.end(); }
    const email = q.login_hint || (q.prompt.includes('select_account') && fake.auth > 1 ? 'work@company.com' : 'me@gmail.com');
    const code = 'c' + (++fake.n);
    fake.codes[code] = { challenge: q.code_challenge, scope: q.scope, email, redirect: q.redirect_uri };
    res.writeHead(302, { Location: `${q.redirect_uri}?code=${code}&state=${q.state}` }); return res.end();
  }
  if (u.pathname === '/token') {
    if (body.get('client_id') !== 'test-client' || body.get('client_secret') !== 'test-secret') return json(401, { error: 'invalid_client' });
    if (body.get('grant_type') === 'authorization_code') {
      const c = fake.codes[body.get('code')];
      delete fake.codes[body.get('code')];
      if (!c || c.redirect !== body.get('redirect_uri')) return json(400, { error: 'invalid_grant' });
      if (b64url(crypto.createHash('sha256').update(body.get('code_verifier') || '').digest()) !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE 불일치' });
      const rt = `rt-${c.email}-${++fake.n}`;
      fake.rts[rt] = { email: c.email, scope: c.scope };
      return json(200, { access_token: `at-${c.email}-${++fake.n}`, refresh_token: rt, expires_in: 3599, scope: c.scope, token_type: 'Bearer' });
    }
    if (body.get('grant_type') === 'refresh_token') {
      fake.refresh++;
      const r = fake.rts[body.get('refresh_token')];
      if (!r || fake.revoked.has(body.get('refresh_token'))) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: `at-${r.email}-${++fake.n}`, expires_in: 3599, scope: r.scope, token_type: 'Bearer' });
    }
  }
  if (u.pathname === '/userinfo') {
    const m = (req.headers.authorization || '').match(/^Bearer at-(.+)-\d+$/);
    return m ? json(200, { email: m[1] }) : json(401, {});
  }
  if (u.pathname === '/revoke') { fake.revoked.add(body.get('token')); return json(200, {}); }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (n, c, note = '') => console.log(c ? '✅' : '❌', n, note ? `— ${note}` : '');
const userData = `${process.env.APPDATA}\\Damda`;
const acctFile = `${userData}\\google-accounts.json`;
const readAccts = () => { try { return JSON.parse(fs.readFileSync(acctFile, 'utf8')); } catch { return {}; } };
const killApp = () => { try { execSync('powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force"'); } catch {} };

async function launch() {
  spawn(`${ROOT}desktop/node_modules/electron/dist/electron.exe`, ['.', '--dev', `--remote-debugging-port=${DBG}`], { cwd: `${ROOT}desktop`, env: { ...process.env, DAMDA_OAUTH_TEST: `http://127.0.0.1:${PORT}` }, detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 40; i++) { await sleep(500); try { const l = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); const t = l.find(t => t.type === 'page' && t.url.startsWith('http://localhost:5500/') && !t.url.includes('__damda')); if (t) { await sleep(1500); return t; } } catch {} }
  throw new Error('앱이 안 켜짐');
}
async function connect(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const wait = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); wait.get(d.id)?.(d); };
  const ev = e => new Promise(r => { const i = ++id; wait.set(i, d => r(d.result?.exceptionDetails ? { error: d.result.exceptionDetails.exception?.description?.split('\n')[0] } : d.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise: true } })); });
  return { ev, close: () => ws.close() };
}
const DRIVE = 'https://www.googleapis.com/auth/drive.appdata', EMAIL = 'https://www.googleapis.com/auth/userinfo.email', CAL = 'https://www.googleapis.com/auth/calendar.readonly';
const tok = (P, o) => P.ev(`window.desk.googleToken(${JSON.stringify(o)}).catch(e => ({ error: e.message }))`);

killApp(); await sleep(800);
try { fs.unlinkSync(acctFile); } catch {}
let P = await connect(await launch());
await P.ev(`localStorage.removeItem('ple-gscopes'); localStorage.removeItem('ple-gtoken')`); // 지난 시험이 켜 둔 추가 권한 비우기

// 1) 처음 로그인 → 브라우저 로그인
let r = await tok(P, { scopes: [DRIVE, EMAIL], hint: '' });
ok('처음: 브라우저 로그인으로 토큰 받음', r?.token?.startsWith('at-me@gmail.com') && fake.auth === 1, JSON.stringify(r).slice(0, 90));
ok('처음: PKCE·오프라인·동의 화면 요청', fake.lastAuth?.code_challenge_method === 'S256' && fake.lastAuth?.access_type === 'offline' && fake.lastAuth?.prompt === 'consent');
ok('처음: 어떤 계정인지 알아냄', r?.email === 'me@gmail.com');
const raw = fs.readFileSync(acctFile, 'utf8');
ok('다시 받기 권한을 이 PC에 보관 (암호화돼서 원문이 안 보임)', !!readAccts()['me@gmail.com'] && !raw.includes('rt-me@gmail.com'));

// 2) 같은 계정·같은 권한 → 브라우저 없이
r = await tok(P, { scopes: [DRIVE, EMAIL], hint: 'me@gmail.com' });
ok('다음부터: 브라우저 없이 조용히 새 토큰', r?.token?.startsWith('at-me@gmail.com') && fake.auth === 1 && fake.refresh === 1);

// 3) 권한 추가(캘린더) → 브라우저 한 번 더, 보관 권한 갱신
r = await tok(P, { scopes: [DRIVE, EMAIL, CAL], hint: 'me@gmail.com' });
ok('권한 추가하면 브라우저로 한 번 더 (기존 권한 포함)', fake.auth === 2 && fake.lastAuth?.include_granted_scopes === 'true' && fake.lastAuth?.login_hint === 'me@gmail.com');
ok('보관한 권한에 캘린더 추가됨', (readAccts()['me@gmail.com']?.scope || '').includes(CAL));
r = await tok(P, { scopes: [CAL], hint: 'me@gmail.com' });
ok('그 뒤 캘린더 권한도 조용히', !r?.error && fake.auth === 2);

// 4) 조용히만 시도: 모르는 계정이면 브라우저 안 열고 실패
r = await tok(P, { scopes: [DRIVE], hint: 'nobody@x.com', silent: true });
ok('조용히만 시도: 브라우저를 열지 않고 실패', r?.error === '다시 로그인이 필요해요.' && fake.auth === 2, r?.error);

// 5) 다른 계정 추가 (계정 고르기)
r = await tok(P, { scopes: [CAL], prompt: 'select_account' });
ok('다른 계정 추가: 계정 고르기 화면부터', fake.lastAuth?.prompt === 'select_account consent' && r?.email === 'work@company.com');
ok('두 계정 모두 보관', Object.keys(readAccts()).sort().join() === 'me@gmail.com,work@company.com');

// 6) 계정 빼기 → 보관 삭제 + 구글에 권한 돌려줌
await P.ev(`window.desk.googleForget('work@company.com')`);
ok('계정 빼기: 보관 삭제 + 권한 돌려줌', !readAccts()['work@company.com'] && [...fake.revoked].some(t => t.startsWith('rt-work@company.com')));

// 7) 웹 코드(google.js)를 거쳐서: signIn → 토큰 보관 + 연결 상태
const authBefore7 = fake.auth;
console.log('   (7 전) 보관 권한:', readAccts()['me@gmail.com']?.scope, '/ 추가 권한 설정:', await P.ev(`localStorage.getItem('ple-gscopes')`));
r = await P.ev(`import('./js/sync/google.js').then(async g => { await g.signIn('me@gmail.com'); return { has: g.hasToken(), drive: g.hasScope('${DRIVE}') }; })`);
ok('웹 코드 signIn이 PC 앱 로그인으로 동작 (브라우저 없이)', r?.has && r?.drive && fake.auth === authBefore7, JSON.stringify(r) + (fake.auth !== authBefore7 ? ' 요청 권한: ' + fake.lastAuth?.scope : ''));
r = await P.ev(`import('./js/sync/google.js').then(g => g.requestToken({ scopes: ['${CAL}'], prompt: 'select_account' }).then(() => 'ok', e => e.message))`);
ok('취소 없이 정상 동작하는지 (계정 추가 → work 다시)', r === 'ok');
await P.ev(`window.desk.googleForget('work@company.com')`);

// 8) 거절(취소)하면 알림
r = await tok(P, { scopes: [DRIVE], hint: 'deny@x.com' });
ok('브라우저에서 취소하면 "로그인을 취소했어요"', r?.error === '로그인을 취소했어요.', r?.error);

// 9) 앱을 껐다 켜도 브라우저 없이
P.close(); killApp(); await sleep(1200);
const before = fake.auth;
P = await connect(await launch());
r = await tok(P, { scopes: [DRIVE, EMAIL], hint: 'me@gmail.com', silent: true });
ok('앱을 다시 켜도 브라우저 없이 (보관한 권한을 다시 풀어 씀)', r?.token?.startsWith('at-me@gmail.com') && fake.auth === before);

// 10) 구글에서 권한이 취소됐으면: 조용히는 실패, 보관도 지움
for (const t of Object.keys(fake.rts)) if (t.startsWith('rt-me@gmail.com')) fake.revoked.add(t);
r = await tok(P, { scopes: [DRIVE, EMAIL], hint: 'me@gmail.com', silent: true });
ok('권한이 취소됐으면 조용히는 실패하고 보관도 지움', !!r?.error && !readAccts()['me@gmail.com'], r?.error);

// 11) 연결 끊기 → 전부 지움
await tok(P, { scopes: [DRIVE, EMAIL], hint: '' });
await P.ev(`import('./js/sync/google.js').then(g => g.signOut())`); await sleep(500);
ok('연결 끊기: 보관한 로그인 권한 모두 지움', Object.keys(readAccts()).length === 0);

P.close(); killApp(); server.close();
try { fs.unlinkSync(acctFile); } catch {}
