// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// helpers.js — CLOUDE CART 🛒 | Shared Utilities
// Cross-Bot Photo Relay + Permanent QR Storage Fix
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const { getDb, saveDb } = require('./db');

let _userBot  = null;
let _adminBot = null;
function setBots(u, a) { _userBot = u; _adminBot = a; }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CROSS-BOT PHOTO RELAY SYSTEM
// Problem: file_id is bot-specific. BotA file_id ≠ BotB.
// Fix: Download bytes → Buffer → re-upload via other bot.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// User Bot → Admin Bot (payment screenshots)
async function relayPhotoToAdmin(userFileId, adminChatId) {
  try {
    const stream = _userBot.getFileStream(userFileId);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buf = Buffer.concat(chunks);
    const sent = await _adminBot.sendPhoto(adminChatId, buf);
    return sent.photo[sent.photo.length - 1].file_id;
  } catch (e) {
    console.error('[RELAY U→A]', e.message);
    return null;
  }
}

// Admin Bot → User Bot (QR codes)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// QR PERMANENT STORAGE FIX:
// Telegram file_id expires if not served from any chat.
// Fix: Store QR permanently in STORAGE_CHAT_ID (a private
// group/channel where BOTH bots are admin).
// That message stays forever → file_id stays valid forever.
// Set STORAGE_CHAT_ID in .env — create a private group,
// add both bots as admin, copy the group's chat ID.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function mintUserBotFileId(adminFileId) {
  try {
    // Step 1: Download QR bytes from Admin Bot
    const stream = _adminBot.getFileStream(adminFileId);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buf = Buffer.concat(chunks);

    // Step 2: Send via User Bot to STORAGE_CHAT_ID (permanent)
    // This keeps the file alive on Telegram servers indefinitely
    const storageChatId = process.env.STORAGE_CHAT_ID || process.env.OWNER_ID;

    const storedUser = await _userBot.sendPhoto(storageChatId, buf, {
      caption: '🗄️ QR Storage [User Bot] — Do not delete',
    });
    const userFileId = storedUser.photo[storedUser.photo.length - 1].file_id;

    // Step 3: Also store via Admin Bot for admin-side file_id
    const storedAdmin = await _adminBot.sendPhoto(storageChatId, buf, {
      caption: '🗄️ QR Storage [Admin Bot] — Do not delete',
    });
    const adminFileIdStored = storedAdmin.photo[storedAdmin.photo.length - 1].file_id;

    return { userFileId, adminFileIdStored };
  } catch (e) {
    console.error('[RELAY A→U]', e.message);
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATE MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const _us = {}, _as = {};
function setUserState(id, state, data={})  { _us[String(id)] = { state, data }; }
function getUserState(id)                  { return _us[String(id)] || null; }
function clearUserState(id)               { delete _us[String(id)]; }
function setAdminState(id, state, data={}) { _as[String(id)] = { state, data }; }
function getAdminState(id)                 { return _as[String(id)] || null; }
function clearAdminState(id)              { delete _as[String(id)]; }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FORMATTING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function inrToUsdt(inr) {
  const rate = getDb().settings.usdtToInrRate || 90;
  return (inr / rate).toFixed(2);
}
function formatBalance(inr) { return `₹${inr.toFixed(2)} ($${inrToUsdt(inr)})`; }
function flashSaleTimeLeft(endsAt) {
  const d = endsAt - Date.now(); if (d <= 0) return null;
  const h = Math.floor(d/3600000), m = Math.floor((d%3600000)/60000), s = Math.floor((d%60000)/1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function medal(i) { return ['🥇','🥈','🥉'][i] || `${i+1}.`; }

Object.defineProperty(module.exports, '_adminBot', { get: () => _adminBot, set: v => { _adminBot = v; } });
Object.defineProperty(module.exports, '_userBot',  { get: () => _userBot,  set: v => { _userBot  = v; } });

module.exports = Object.assign(module.exports, {
  setBots, relayPhotoToAdmin, mintUserBotFileId,
  setUserState, getUserState, clearUserState,
  setAdminState, getAdminState, clearAdminState,
  inrToUsdt, formatBalance, flashSaleTimeLeft, medal,
});
