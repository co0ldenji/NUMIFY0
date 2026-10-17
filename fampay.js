/**
 * FamPay-style auto verify: unique purpose in UPI QR + Gmail IMAP scan
 * (same idea as MatrixRobots/Fampay-payment-gateway, Node port)
 */
const crypto = require('crypto');
const QRCode = require('qrcode');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const pending = new Map(); // orderId -> { userId, amount, purpose, createdAt, expiresAt }

function cfg() {
  return {
    upiId: process.env.DEFAULT_UPI_ID || '',
    payee: process.env.DEFAULT_PAYEE_NAME || 'Pay',
    prefix: process.env.PURPOSE_PREFIX || 'NV',
    imapUser: process.env.IMAP_USERNAME || '',
    imapPass: (process.env.IMAP_APP_PASSWORD || '').replace(/\s/g, ''),
    imapHost: process.env.IMAP_HOST || 'imap.gmail.com',
    expiryMin: Number(process.env.ORDER_EXPIRY_MINUTES || 15),
    enabled: process.env.FAMPAY_ENABLED === '1' || process.env.FAMPAY_ENABLED === 'true',
  };
}

function enabled() {
  const c = cfg();
  return c.enabled && c.upiId && c.imapUser && c.imapPass;
}

function makePurpose() {
  const c = cfg();
  return `${c.prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function makeOrderId() {
  return `ORD-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
}

function upiUri(amount, purpose) {
  const c = cfg();
  const params = new URLSearchParams({
    pa: c.upiId,
    pn: c.payee,
    am: Number(amount).toFixed(2),
    cu: 'INR',
    tn: purpose,
  });
  return `upi://pay?${params.toString()}`;
}

async function createOrder(userId, amount) {
  if (!enabled()) throw new Error('FamPay not configured (UPI/IMAP/.env)');
  const purpose = makePurpose();
  const id = makeOrderId();
  const createdAt = Date.now();
  const expiresAt = createdAt + cfg().expiryMin * 60 * 1000;
  const uri = upiUri(amount, purpose);
  const qrPng = await QRCode.toBuffer(uri, { type: 'png', width: 512, margin: 2 });
  pending.set(id, { userId, amount: Number(amount), purpose, createdAt, expiresAt, status: 'pending' });
  return { id, userId, amount: Number(amount), purpose, qrPng, upiUri: uri, expiresAt };
}

async function searchImap(purpose, amount, createdAt) {
  const c = cfg();
  const client = new ImapFlow({
    host: c.imapHost,
    port: 993,
    secure: true,
    auth: { user: c.imapUser, pass: c.imapPass },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(createdAt - 5 * 60 * 1000);
      // search recent from famapp
      const uids = await client.search({
        since,
        from: 'no-reply@famapp.in',
      });
      if (!uids || !uids.length) return false;
      const list = uids.slice(-30);
      for (const uid of list) {
        const msg = await client.fetchOne(uid, { source: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const body = `${parsed.subject || ''}\n${parsed.text || ''}\n${parsed.html || ''}`;
        if (body.includes(purpose)) {
          // optional amount check
          const amtStr = Number(amount).toFixed(2);
          if (body.includes(amtStr) || body.includes(String(Math.floor(amount))) || body.includes(purpose)) {
            return true;
          }
          return true; // purpose match is enough
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch (_) {}
  }
  return false;
}

async function verify(orderId) {
  const o = pending.get(orderId);
  if (!o) return { verified: false, status: 'not_found', message: 'Order not found' };
  if (o.status === 'verified') return { verified: true, status: 'verified', message: 'Already verified' };
  if (Date.now() >= o.expiresAt) {
    o.status = 'expired';
    return { verified: false, status: 'expired', message: 'Order expired' };
  }
  const ok = await searchImap(o.purpose, o.amount, o.createdAt);
  if (ok) {
    o.status = 'verified';
    return { verified: true, status: 'verified', message: 'Payment verified', amount: o.amount, userId: o.userId };
  }
  return { verified: false, status: 'pending', message: 'No matching email yet' };
}

function getOrder(orderId) {
  return pending.get(orderId) || null;
}

/**
 * Poll until verified or expired
 */
function pollUntilPaid(orderId, onSuccess, onExpire, intervalMs = 15000) {
  const timer = setInterval(async () => {
    try {
      const r = await verify(orderId);
      if (r.verified) {
        clearInterval(timer);
        onSuccess && onSuccess(r);
      } else if (r.status === 'expired' || r.status === 'not_found') {
        clearInterval(timer);
        onExpire && onExpire(r);
      }
    } catch (e) {
      console.error('fampay poll', e.message);
    }
  }, intervalMs);
  return timer;
}

module.exports = { enabled, createOrder, verify, getOrder, pollUntilPaid, cfg };
  
