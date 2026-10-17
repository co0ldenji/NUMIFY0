// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// db.js — CLOUDE CART 🛒 | JSON Database Layer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs   = require('fs');
const path = require('path');
const DB_PATH  = path.join(__dirname, 'data.json');
const TMP_PATH = DB_PATH + '.tmp';

const DEFAULT = {
  settings: {
    joinLinks: [],           // { name, url, enabled }
    supportUsername: 'support',
    usdtToInrRate: 90,
    minDepositInr: 20,
    payments: {
      gpay:    { enabled: true,  qrFileId: null, qrFileIdAdmin: null, upiId: null,      upiName: null },
      fampay:  { enabled: true,  qrFileId: null, qrFileIdAdmin: null, upiId: null,      upiName: null },
      anyupi:  { enabled: true,  qrFileId: null, qrFileIdAdmin: null, upiId: null,      upiName: null },
      binance: { enabled: true,  binanceId: null, binanceName: null },
    },
    features: {
      buyAccount: true, buySession: true,
      deposit: true, referEarn: true,
      support: true, leaderboard: true,
    },
    flashSale: { active: false, productId: null, discountPercent: 0, endsAt: null },
  },
  products: {}, users: {}, deposits: {}, orders: {},
  admins: {}, referrals: {}, notifyQueue: {}, bans: {},
  _nextId: 1,
};

let _db = null;

function deepMerge(src, tgt) {
  const out = Object.assign({}, src);
  for (const k of Object.keys(tgt)) {
    if (tgt[k] && typeof tgt[k] === 'object' && !Array.isArray(tgt[k]))
      out[k] = deepMerge(src[k] || {}, tgt[k]);
    else out[k] = tgt[k];
  }
  return out;
}

function loadDb() {
  if (_db) return _db;
  if (fs.existsSync(DB_PATH)) {
    try { _db = deepMerge(DEFAULT, JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))); }
    catch (_) { _db = JSON.parse(JSON.stringify(DEFAULT)); }
  } else { _db = JSON.parse(JSON.stringify(DEFAULT)); }

  // Inventory migration: every sellable digital product keeps one credential
  // object per stock unit. Legacy products without inventory cannot be sold
  // until credentials are added through the Admin Bot.
  let changed = false;
  Object.keys(_db.products).forEach(function(id) {
    const p = _db.products[id];
    if (!Array.isArray(p.inventory)) {
      p.inventory = [];
      p.stock = 0;
      changed = true;
    } else if (p.stock !== p.inventory.length) {
      p.stock = p.inventory.length;
      changed = true;
    }
  });
  if (changed) saveDb();
  return _db;
}

function getDb()  { if (!_db) loadDb(); return _db; }
function saveDb() {
  fs.writeFileSync(TMP_PATH, JSON.stringify(_db, null, 2), 'utf8');
  fs.renameSync(TMP_PATH, DB_PATH);
}

function nextId() {
  const db = getDb(); const id = String(db._nextId++); saveDb(); return id;
}

// ── USERS ──────────────────────────────────────────────
function getUser(userId) {
  const db = getDb(); const id = String(userId);
  if (!db.users[id]) {
    db.users[id] = {
      userId: id, username: null, firstName: null,
      balance: 0, totalDeposited: 0, depositCount: 0,
      referredBy: null, referralCount: 0, referralEarned: 0,
      joinedAt: Date.now(),
    };
    saveDb();
  }
  return db.users[id];
}
function updateUser(userId, patch) {
  const db = getDb(); const id = String(userId);
  getUser(id); Object.assign(db.users[id], patch); saveDb();
}
function isBanned(userId) { return !!getDb().bans[String(userId)]; }
function banUser(userId)   { getDb().bans[String(userId)] = true; saveDb(); }
function unbanUser(userId) { delete getDb().bans[String(userId)]; saveDb(); }

// ── PRODUCTS ───────────────────────────────────────────
function addProduct(data) {
  const db = getDb(); const id = nextId();
  const inventory = Array.isArray(data.inventory) ? data.inventory : [];
  db.products[id] = {
    id,
    stock: inventory.length,
    inventory: inventory,
    sessionMode: false,
    flashSale: false,
    ...data,
    stock: inventory.length,
    createdAt: Date.now()
  };
  saveDb(); return db.products[id];
}
function getProduct(id) {
  const p = getDb().products[String(id)] || null;
  if (p && !Array.isArray(p.inventory)) p.inventory = [];
  if (p && p.stock !== p.inventory.length) p.stock = p.inventory.length;
  return p;
}
function updateProduct(id, p) {
  const db = getDb(); const product = db.products[String(id)];
  if (!product) return false;
  Object.assign(product, p);
  if (!Array.isArray(product.inventory)) product.inventory = [];
  product.stock = product.inventory.length;
  saveDb(); return true;
}
function addInventoryItems(id, items) {
  const db = getDb(); const product = db.products[String(id)];
  if (!product) return false;
  if (!Array.isArray(product.inventory)) product.inventory = [];
  Array.prototype.push.apply(product.inventory, items);
  product.stock = product.inventory.length;
  saveDb(); return true;
}
function consumeInventoryItem(id) {
  const db = getDb(); const product = db.products[String(id)];
  if (!product || !Array.isArray(product.inventory) || !product.inventory.length) return null;
  const item = product.inventory.shift();
  product.stock = product.inventory.length;
  saveDb();
  return item;
}
function restoreInventoryItem(id, item) {
  const db = getDb(); const product = db.products[String(id)];
  if (!product) return false;
  if (!Array.isArray(product.inventory)) product.inventory = [];
  product.inventory.unshift(item);
  product.stock = product.inventory.length;
  saveDb(); return true;
}
function getInventory(id) {
  const p = getProduct(id);
  return p ? p.inventory : [];
}
function deleteProduct(id)     { delete getDb().products[String(id)]; saveDb(); }
function listProducts(sessionMode) { return Object.values(getDb().products).filter(p => !!p.sessionMode === !!sessionMode); }

// ── DEPOSITS ───────────────────────────────────────────
function createDeposit(data) {
  const db = getDb(); const id = nextId();
  db.deposits[id] = { id, status: 'pending', createdAt: Date.now(), ...data }; saveDb(); return db.deposits[id];
}
function getDeposit(id)        { return getDb().deposits[String(id)] || null; }
function updateDeposit(id, p)  { const db = getDb(); if (!db.deposits[String(id)]) return false; Object.assign(db.deposits[String(id)], p); saveDb(); return true; }
function getPendingDeposits()  { return Object.values(getDb().deposits).filter(d => d.status === 'pending'); }

// ── ORDERS ─────────────────────────────────────────────
function createOrder(data) {
  const db = getDb(); const id = nextId();
  db.orders[id] = { id, status: 'pending_delivery', createdAt: Date.now(), ...data }; saveDb(); return db.orders[id];
}
function getOrder(id)          { return getDb().orders[String(id)] || null; }
function updateOrder(id, p)    { const db = getDb(); if (!db.orders[String(id)]) return false; Object.assign(db.orders[String(id)], p); saveDb(); return true; }
function getPendingOrders()    { return Object.values(getDb().orders).filter(o => o.status === 'pending_delivery' || o.status === 'delivery_pending' || o.status === 'password_pending'); }

// ── REFERRALS ──────────────────────────────────────────
function createReferral(referrerId, referredId, reward) {
  const db = getDb(); const id = nextId();
  db.referrals[id] = { id, referrerId: String(referrerId), referredId: String(referredId), status: 'pending', rewardAmount: reward, createdAt: Date.now() };
  saveDb(); return db.referrals[id];
}
function completeReferral(referredId) {
  const db = getDb();
  const ref = Object.values(db.referrals).find(r => r.referredId === String(referredId) && r.status === 'pending');
  if (!ref) return null;
  ref.status = 'completed'; ref.completedAt = Date.now();
  const referrer = getUser(ref.referrerId);
  referrer.balance       += ref.rewardAmount;
  referrer.referralCount += 1;
  referrer.referralEarned += ref.rewardAmount;
  saveDb(); return ref;
}
function hasBeenReferred(referredId) {
  return Object.values(getDb().referrals).some(r => r.referredId === String(referredId));
}

// ── LEADERBOARD ────────────────────────────────────────
function getDepositLeaderboard(n = 10)  { return Object.values(getDb().users).sort((a,b) => b.totalDeposited - a.totalDeposited).slice(0,n); }
function getReferralLeaderboard(n = 10) { return Object.values(getDb().users).sort((a,b) => b.referralCount - a.referralCount).slice(0,n); }

// ── ADMINS ─────────────────────────────────────────────
function isAdmin(userId)          { return !!getDb().admins[String(userId)]; }
function addAdmin(userId, by)     { getDb().admins[String(userId)] = { userId: String(userId), addedAt: Date.now(), addedBy: String(by) }; saveDb(); }
function removeAdmin(userId)      { delete getDb().admins[String(userId)]; saveDb(); }
function listAdmins()             { return Object.values(getDb().admins); }

module.exports = {
  getDb, saveDb, loadDb, nextId,
  getUser, updateUser, isBanned, banUser, unbanUser,
  addProduct, getProduct, updateProduct, deleteProduct, listProducts,
  addInventoryItems, consumeInventoryItem, restoreInventoryItem, getInventory,
  createDeposit, getDeposit, updateDeposit, getPendingDeposits,
  createOrder, getOrder, updateOrder, getPendingOrders,
  createReferral, completeReferral, hasBeenReferred,
  getDepositLeaderboard, getReferralLeaderboard,
  isAdmin, addAdmin, removeAdmin, listAdmins,
};
      
