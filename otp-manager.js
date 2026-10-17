/**
 * GramJS session manager + auto OTP from 777000 + session management
 */
const fs = require('fs');
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');

const SESS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESS_DIR)) fs.mkdirSync(SESS_DIR, { recursive: true });

function apiCreds() {
  const id = Number(process.env.API_ID || 0);
  const hash = process.env.API_HASH || '';
  return { id, hash };
}

function ready() {
  const { id, hash } = apiCreds();
  return id > 0 && hash.length > 10;
}

function sessionFile(phone) {
  const p = String(phone).replace(/\D/g, '');
  return path.join(SESS_DIR, p + '.session.txt');
}

function loadSession(phone) {
  const f = sessionFile(phone);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  return '';
}

function saveSession(phone, str) {
  fs.writeFileSync(sessionFile(phone), str || '', 'utf8');
}

function hasSession(phone) {
  return loadSession(phone).length > 10;
}

function deleteSessionFile(phone) {
  const f = sessionFile(phone);
  try {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch (_) {}
}

async function getClient(phone) {
  if (!ready()) throw new Error('API_ID / API_HASH missing');
  const phoneNorm = String(phone).replace(/\D/g, '');
  const sess = loadSession(phoneNorm);
  if (!sess) throw new Error('Session missing for +' + phoneNorm);
  const { id, hash } = apiCreds();
  const client = new TelegramClient(new StringSession(sess), id, hash, {
    connectionRetries: 5,
  });
  await client.connect();
  if (!(await client.checkAuthorization())) {
    await client.disconnect();
    throw new Error('Session dead for +' + phoneNorm);
  }
  return { client, phoneNorm };
}

/**
 * Admin: login phone with code (+ optional 2FA)
 */
async function createSession(phone, codeProvider, passwordProvider) {
  if (!ready()) throw new Error('API_ID / API_HASH missing in .env');
  const { id, hash } = apiCreds();
  const phoneNorm = String(phone).replace(/\D/g, '');
  const client = new TelegramClient(new StringSession(''), id, hash, {
    connectionRetries: 5,
  });
  await client.connect();
  await client.start({
    phoneNumber: async () => phoneNorm,
    phoneCode: async () => codeProvider(),
    password: async () => (passwordProvider ? passwordProvider() : ''),
    onError: (err) => console.error('otp login', err.message),
  });
  const sessionStr = client.session.save();
  saveSession(phoneNorm, sessionStr);
  const me = await client.getMe();
  await client.disconnect();
  return { phone: phoneNorm, name: me.firstName || '', sessionSaved: true };
}

const OTP_RE = /\b(\d{4,8})\b/;

async function listenOtp(phone, onCode, onStatus, timeoutMs = 600000) {
  if (!ready()) {
    onStatus && onStatus('API_ID/HASH not set');
    return;
  }
  const phoneNorm = String(phone).replace(/\D/g, '');
  const sess = loadSession(phoneNorm);
  if (!sess) {
    onStatus && onStatus('Session missing for +' + phoneNorm);
    return;
  }
  const { id, hash } = apiCreds();
  const client = new TelegramClient(new StringSession(sess), id, hash, {
    connectionRetries: 5,
  });
  await client.connect();
  if (!(await client.checkAuthorization())) {
    onStatus && onStatus('Session dead for +' + phoneNorm);
    await client.disconnect();
    return;
  }
  onStatus && onStatus('listening');
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const msgs = await client.getMessages(777000, { limit: 5 });
      for (const m of msgs) {
        if (!m.message || !m.date) continue;
        const ts = m.date * 1000;
        if (ts < start - 20000) continue;
        if (String(m.message).includes('Login detected')) continue;
        const match = String(m.message).match(OTP_RE);
        if (match && match[1] !== last) {
          last = match[1];
          await onCode(match[1]);
          await client.disconnect();
          return;
        }
      }
    } catch (e) {
      console.error('otp poll', e.message);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  onStatus && onStatus('timeout');
  try { await client.disconnect(); } catch (_) {}
}

/**
 * Permanently remove bot session (logout + delete file)
 */
async function terminateBotSession(phone) {
  const phoneNorm = String(phone).replace(/\D/g, '');
  try {
    const { client } = await getClient(phoneNorm);
    try {
      await client.invoke(new Api.auth.LogOut());
    } catch (_) {}
    try { await client.disconnect(); } catch (_) {}
  } catch (_) {
    // still delete file even if already dead
  }
  deleteSessionFile(phoneNorm);
  return true;
}

/**
 * List active authorizations (other devices/apps)
 * Returns array of { hash, device, platform, app, country, dateActive, current }
 */
async function listAuthorizations(phone) {
  const { client, phoneNorm } = await getClient(phone);
  try {
    const result = await client.invoke(new Api.account.GetAuthorizations());
    const list = (result.authorizations || []).map((a) => ({
      hash: String(a.hash),
      device: a.deviceModel || a.appName || 'Unknown',
      platform: a.platform || '',
      app: a.appName || '',
      country: a.country || '',
      ip: a.ip || '',
      dateActive: a.dateActive || 0,
      dateCreated: a.dateCreated || 0,
      current: !!a.current,
    }));
    await client.disconnect();
    return list;
  } catch (e) {
    try { await client.disconnect(); } catch (_) {}
    throw e;
  }
}

/**
 * Terminate one remote authorization by hash (not current bot session unless user wants)
 */
async function resetAuthorization(phone, hash) {
  const { client } = await getClient(phone);
  try {
    await client.invoke(new Api.account.ResetAuthorization({ hash: BigInt(hash) }));
    await client.disconnect();
    return true;
  } catch (e) {
    try { await client.disconnect(); } catch (_) {}
    throw e;
  }
}

module.exports = {
  ready,
  hasSession,
  createSession,
  listenOtp,
  loadSession,
  saveSession,
  sessionFile,
  deleteSessionFile,
  terminateBotSession,
  listAuthorizations,
  resetAuthorization,
};
    
