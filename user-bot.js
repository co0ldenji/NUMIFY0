require('dotenv').config();
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// user-bot.js — CLOUDE CART 🛒 | Customer-Facing Bot
// FIXES: 409 conflict, join gate, products, duplicate msgs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const h  = require('./helpers');
const fampay = require('./fampay');
const otpManager = require('./otp-manager');

// FIX 409: webHook:false + no duplicate polling instance
const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: { interval: 1000, autoStart: true, params: { timeout: 10 } },
});
bot.on('polling_error', (err) => {
  const msg = err && (err.message || err.code || String(err));
  console.error('[user polling_error]', msg);
});
bot.on('error', (err) => console.error('[user error]', err && err.message));
module.exports = { bot };

// Answer each callback_query at most once (avoids 400 query too old / invalid)
const _answeredCb = new Set();
async function safeAnswer(q, opts) {
  if (!q || !q.id) return;
  if (_answeredCb.has(q.id)) return;
  _answeredCb.add(q.id);
  try {
    await bot.answerCallbackQuery(q.id, opts || {});
  } catch (e) {
    // ignore expired/invalid query
  }
  if (_answeredCb.size > 2000) {
    const arr = [..._answeredCb];
    arr.slice(0, 1000).forEach((id) => _answeredCb.delete(id));
  }
}


const ADMIN_CHAT   = process.env.ADMIN_NOTIFY_CHAT_ID;
const STORAGE_CHAT = process.env.STORAGE_CHAT_ID || process.env.ADMIN_NOTIFY_CHAT_ID;
const REF_REWARD   = Number(process.env.REFERRAL_REWARD_INR) || 10;

// ── Duplicate callback guard ───────────────────────────
const _seen = new Map();
function isDupe(id) {
  if (_seen.has(id)) return true;
  _seen.set(id, 1); setTimeout(() => _seen.delete(id), 6000); return false;
}

// ── Send / Edit helpers ────────────────────────────────
const send = (c, t, o={}) => bot.sendMessage(c, t, { parse_mode:'HTML', ...o });
async function edit(c, m, t, o={}) {
  try { await bot.editMessageText(t, { chat_id:c, message_id:m, parse_mode:'HTML', ...o }); }
  catch(_){}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// JOIN GATE
// FIX: always check on /start, support URL delete too
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function checkJoined(userId) {
  const links = db.getDb().settings.joinLinks.filter(l => l.enabled);
  if (!links.length) return true;
  for (const l of links) {
    const m = l.url.match(/t\.me\/(?:\+)?([^/?]+)/);
    if (!m) continue;
    try {
      const mem = await bot.getChatMember('@' + m[1], userId);
      if (['left','kicked'].includes(mem.status)) return false;
    } catch(_) {}
  }
  return true;
}

async function showJoinGate(chatId, msgId=null) {
  const links = db.getDb().settings.joinLinks.filter(l => l.enabled);

  const text =
    `👋 <b>Welcome to NEXVAULT SHOP 🛒!</b>\n\n` +
    `🔒 Please join our official channels to use the bot:\n\n` +
    links.map(l => `📣 ${l.name}`).join('\n') +
    `\n\nTap the buttons below to join all channels.\n\n` +
    `After joining, tap <b>✅ I Joined</b> to continue.`;

  const kb = [
    ...links.map(l => [{
      text: `📣 ${l.name}`,
      url: l.url,
      style: 'primary'
    }]),
    [{
      text: '✅ I Joined',
      callback_data: 'check_join',
      style: 'success'
    }]
  ];

  const opts = {
    reply_markup: {
      inline_keyboard: kb
    }
  };

  if (msgId) return edit(chatId, msgId, text, opts);
  return send(chatId, text, opts);
}


// MAIN MENU
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function showMenu(chatId, msgId=null, isNew=false) {
  const f = db.getDb().settings.features;
  const text = isNew
    ? `🛒 <b>Choose the items you need:</b>\n\n❗️ If you have not used our products before, please make a small test purchase first to avoid unnecessary disputes! Thank you for your cooperation`
    : `🛒 <b>NEXVAULT SHOP</b> — Choose an option:`;
  const r1=[], r2=[], r3=[];
  if (f.buyAccount) r1.push({text:'🛒 Buy Account',  callback_data:'buy_account', style:'success'});
  if (f.buySession) r1.push({text:'📂 Buy Sessions', callback_data:'buy_session', style:'success'});
  if (f.deposit)    r2.push({text:'👤 Profile',      callback_data:'profile', style:'primary'});
  if (f.deposit)    r2.push({text:'💰 Deposit',      callback_data:'deposit', style:'success'});
  if (f.referEarn)  r3.push({text:'🎁 Refer & Earn', callback_data:'refer_earn', style:'success'});
  if (f.support)    r3.push({text:'📞 Support',      callback_data:'support', style:'primary'});
  const kb = [r1,r2,r3].filter(r=>r.length);
  const opts = { reply_markup:{inline_keyboard:kb} };
  if (msgId) return edit(chatId, msgId, text, opts);
  return send(chatId, text, opts);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// /start
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId  = msg.chat.id;
  const userId  = String(msg.from.id);
  const payload = (match[1]||'').trim();

  if (db.isBanned(userId)) return send(chatId, '🚫 You have been banned.');

  const user = db.getUser(userId);
  db.updateUser(userId, {
    username:  msg.from.username  || user.username,
    firstName: msg.from.first_name || user.firstName,
  });

  // Referral
  if (payload.startsWith('ref_') && !db.hasBeenReferred(userId)) {
    const rid = payload.replace('ref_','');
    if (rid !== userId) db.createReferral(rid, userId, REF_REWARD);
  }

  // FIX: always show join gate if not joined
  const joined = await checkJoined(userId);
  if (!joined) return showJoinGate(chatId);

  // Complete referral
  const ref = db.completeReferral(userId);
  if (ref) {
    try {
      const referrer = db.getUser(ref.referrerId);
      send(ref.referrerId, `🎁 <b>Referral Reward!</b>\nSomeone you referred joined!\n+₹${ref.rewardAmount} added.\n💰 Balance: ${h.formatBalance(referrer.balance)}`);
    } catch(_){}
  }

  const isNew = !user.depositCount && !user.totalDeposited;
  showMenu(chatId, null, isNew);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BUY ACCOUNT — FIX: shows all products regardless of stock
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function showBuyAccount(chatId, msgId) {
  const db_  = db.getDb();
  const rate = db_.settings.usdtToInrRate || 90;
  const prods = db.listProducts(false);

  if (!prods.length) return edit(chatId, msgId,
    `📦 <b>No accounts listed yet.</b>`,
    { reply_markup:{inline_keyboard:[[{text:'🔙 Back',callback_data:'main_menu',style:'primary'}]]} }
  );

  // Flash sale
  const fs = db_.settings.flashSale;
  let flashLine = '';
  if (fs && fs.active && fs.endsAt) {
    const tl = h.flashSaleTimeLeft(fs.endsAt);
    if (tl) flashLine = `\n🔥 <b>Flash Sale!</b> Ends in <code>${tl}</code>`;
    else { db_.settings.flashSale.active=false; db.saveDb(); }
  }

  const lines = prods.map(p => {
    const usd   = (p.price/rate).toFixed(2);
    const stock = p.stock>0 ? `${p.stock} In Stock` : '❌ Out of Stock';
    return `${p.emoji||'📦'} ${p.name} | $${usd} • ₹${p.price} | ${stock}`;
  });

  const text =
    `✨ <b>Select Account</b>\n⚡ Rate: 1 USDT = ₹${rate}${flashLine}\n\n` +
    `🟢 Good Quality 2FA\n✅ Age Of The Accounts Are Valued Using (Personal Message)\n\n` +
    lines.join('\n');

  const kb = [
    ...prods.map(p=>[{
      text: `${p.emoji||'📦'} ₹${p.price}`,
      callback_data: p.stock>0 ? `product_${p.id}` : `oos_${p.id}`,
      style: p.stock>0 ? 'success' : 'danger',
    }]),
    [{text:'🔙 Back', callback_data:'main_menu', style:'primary'}],
  ];
  return edit(chatId, msgId, text, { reply_markup:{inline_keyboard:kb} });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BUY SESSION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function showBuySession(chatId, msgId) {
  const rate  = db.getDb().settings.usdtToInrRate || 90;
  const prods = db.listProducts(true);

  if (!prods.length) return edit(chatId, msgId,
    `📂 <b>No sessions listed yet.</b>`,
    { reply_markup:{inline_keyboard:[[{text:'🔙 Back',callback_data:'main_menu',style:'primary'}]]} }
  );

  const lines = prods.map(p => {
    const usd   = (p.price/rate).toFixed(2);
    const stock = p.stock>0 ? `${p.stock} In Stock` : '❌ Out of Stock';
    return `${p.emoji||'📂'} ${p.name} | $${usd} • ₹${p.price} | ${stock}`;
  });

  const text = `📂 <b>Buy Sessions</b>\n⚡ Rate: 1 USDT = ₹${rate}\n\nBuy in bulk — up to available stock\n\n` + lines.join('\n');
  const kb = [
    ...prods.map(p=>[{ text:`${p.emoji||'📂'} ${p.name} — ₹${p.price}`, callback_data: p.stock>0?`product_${p.id}`:`oos_${p.id}`, style: p.stock>0?'success':'danger' }]),
    [{text:'🔙 Back', callback_data:'main_menu', style:'primary'}],
  ];
  return edit(chatId, msgId, text, { reply_markup:{inline_keyboard:kb} });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRODUCT DETAIL + PURCHASE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function showProduct(chatId, msgId, pid) {
  const p    = db.getProduct(pid);
  const rate = db.getDb().settings.usdtToInrRate || 90;
  const back = p && p.sessionMode ? 'buy_session' : 'buy_account';
  if (!p) return edit(chatId, msgId, `❌ Product not found.`, { reply_markup:{inline_keyboard:[[{text:'🔙 Back',callback_data:back,style:'primary'}]]} });
  const usd  = (p.price/rate).toFixed(2);
  const text =
    `${p.emoji||'📦'} <b>${p.name}</b>\n\n💵 $${usd} • ₹${p.price}\n📦 Stock: ${p.stock}` +
    (p.description ? `\n📝 ${p.description}` : '') + `\n\n⚠️ Confirm purchase?`;
  return edit(chatId, msgId, text, { reply_markup:{inline_keyboard:[
    [{text:'✅ Buy Now',callback_data:`buy_${pid}`,style:'success'},{text:'❌ Cancel',callback_data:back,style:'danger'}],
    [{text:'🔙 Back',callback_data:back,style:'primary'}],
  ]}});
}

async function doPurchase(chatId, msgId, userId, pid) {
  const p = db.getProduct(pid);
  const user = db.getUser(userId);
  const rate = db.getDb().settings.usdtToInrRate || 90;
  const back = p && p.sessionMode ? 'buy_session' : 'buy_account';

  if (!p || !Array.isArray(p.inventory) || p.inventory.length < 1) {
    return edit(chatId, msgId, `❌ Out of stock.`, {
      reply_markup:{inline_keyboard:[[{text:'🔙 Back',callback_data:back,style:'primary'}]]}
    });
  }

  if (user.balance < p.price) {
    const short = (p.price - user.balance).toFixed(2);
    return edit(chatId, msgId,
      `💰 <b>Insufficient Balance</b>\n\nNeed ₹${short} more.\nCurrent: ${h.formatBalance(user.balance)}`,
      {reply_markup:{inline_keyboard:[
        [{text:'💳 Deposit Now',callback_data:'deposit',style:'success'}],
        [{text:'🔙 Back',callback_data:back,style:'primary'}]
      ]}}
    );
  }

  // Atomically consume exactly ONE credential from this product.
  // The password is never sent to the admin chat and is never broadcast.
  const deliveryItem = db.consumeInventoryItem(pid);
  if (!deliveryItem) {
    return edit(chatId, msgId, `❌ This product just went out of stock. Please try again.`, {
      reply_markup:{inline_keyboard:[[{text:'🔙 Back',callback_data:back,style:'primary'}]]}
    });
  }

  const newBal = user.balance - p.price;
  db.updateUser(userId, { balance: newBal, totalSpent: (user.totalSpent || 0) + p.price });
  const order = db.createOrder({
    userId: String(userId),
    productId: pid,
    quantity: 1,
    totalPrice: p.price,
    inventoryItemId: deliveryItem.id || null,
    login: deliveryItem.login || '',
    twoFaPassword: deliveryItem.password || '',
    status: 'delivered'
  });
  const usd = (p.price / rate).toFixed(2);

  try {
    // Deliver ONLY the Email/Number immediately. Password stays with admin.
    const phoneLogin = String(deliveryItem.login || '').replace(/\D/g, '');
    const canAutoOtp = otpManager.ready() && otpManager.hasSession(phoneLogin);
    let otpNote = `🔐 <b>OTP:</b> Enter number in Telegram and request code.\n`;
    if (canAutoOtp) {
      otpNote = `⚡ <b>Auto OTP ON</b> — bot will send login code here when it arrives.\n`;
    } else {
      otpNote += `If OTP does not arrive, tap <b>🔄 Get OTP Again</b>.\n`;
    }
    await bot.sendMessage(userId,
      `🎉 <b>Purchase Successful!</b>\n\n` +
      `📦 <b>${p.emoji || '📦'} ${p.name}</b>\n` +
      `💸 Paid: ₹${p.price} ($${usd})\n` +
      `🧾 Order ID: <code>#${order.id}</code>\n\n` +
      `📧 <b>Number:</b> <code>${escapeHtml(deliveryItem.login)}</code>\n\n` +
      otpNote,
      {parse_mode:'HTML', reply_markup:{inline_keyboard:[[
        {text:'🔄 Get OTP Again',callback_data:`fetch_password_${order.id}`,style:'success'}
      ]]}}
    );
    if (canAutoOtp) {
      const twoFa = String(deliveryItem.password || '').trim();
      const REFUND_MS = 5 * 60 * 1000; // 5 minutes
      db.updateOrder(order.id, { otpDelivered: false, refunded: false });

      const doRefundIfNeeded = async (reason) => {
        try {
          const ord = db.getOrder(order.id);
          if (!ord || ord.otpDelivered || ord.refunded) return;
          db.updateOrder(order.id, { refunded: true, status: 'refunded', refundReason: reason || 'otp_timeout' });
          const u = db.getUser(userId);
          db.updateUser(userId, { balance: (u.balance || 0) + p.price });
          try { db.restoreInventoryItem(pid, deliveryItem); } catch(_){}
          await bot.sendMessage(userId,
            `⏰ <b>OTP not received in 5 minutes</b>\n\n` +
            `💰 ₹${p.price} has been <b>refunded</b> to your wallet.\n` +
            `Order #${order.id} cancelled.\n\nYou can buy again when ready.`,
            { parse_mode: 'HTML' }
          );
          try {
            if (ADMIN_CHAT) await bot.sendMessage(ADMIN_CHAT,
              `↩️ Auto-refund order #${order.id} user ${userId} ₹${p.price} (${reason||'otp timeout'})`,
              { parse_mode: 'HTML' });
          } catch(_){}
        } catch (e) {
          console.error('auto refund', e.message);
        }
      };

      const refundTimer = setTimeout(() => { doRefundIfNeeded('5min_no_otp'); }, REFUND_MS);

      otpManager.listenOtp(phoneLogin, async (code) => {
        clearTimeout(refundTimer);
        const ord = db.getOrder(order.id);
        if (ord && ord.refunded) {
          await bot.sendMessage(userId, '⚠️ Order already refunded. OTP ignored.');
          return;
        }
        db.updateOrder(order.id, { otpDelivered: true, lastPasswordSentAt: Date.now(), status: 'delivered', lastOtp: code });
        let text =
          `✅ <b>Purchase Successful!</b>\n\n` +
          `📱 <b>Number:</b> <code>+${phoneLogin}</code>\n` +
          `🔢 <b>OTP:</b> <code>${code}</code>\n`;
        if (twoFa) {
          text += `🔐 <b>2FA Password:</b> <code>${escapeHtml(twoFa)}</code>\n`;
        }
        text += `\n⚠️ Keep these details private.\n\nUse buttons below after you login:`;
        await bot.sendMessage(userId, text, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🗑 Terminate Bot Session', callback_data: `term_sess_${order.id}`, style: 'danger' }],
              [{ text: '📱 Manage Sessions', callback_data: `mgmt_sess_${order.id}`, style: 'primary' }],
              [{ text: '🔄 Get OTP Again', callback_data: `fetch_password_${order.id}`, style: 'success' }],
            ],
          },
        });
      }, async (st) => {
        if (st === 'listening') {
          await bot.sendMessage(userId, '⏳ Listening for OTP (5 min)… open Telegram and request the code now.');
        } else if (st === 'timeout') {
          await doRefundIfNeeded('listener_timeout');
        } else if (st && st !== 'listening') {
          await bot.sendMessage(userId, `⚠️ ${st}`);
        }
      }, REFUND_MS).catch(e => console.error('listenOtp', e.message));
    }

    db.updateOrder(order.id, {status:'password_pending', passwordRequestCount:0});

    await edit(chatId, msgId,
      `✅ <b>Order Purchased!</b>\n\n` +
      `📦 ${p.emoji || '📦'} ${p.name}\n` +
      `💸 ₹${p.price} ($${usd}) deducted\n` +
      `💰 Remaining: ${h.formatBalance(newBal)}\n\n` +
      `📧 <b>Number:</b> <code>${escapeHtml(deliveryItem.login)}</code>\n\n` +
      `🔐 <b>Password:</b> Copy Number And Send Code.
        Waiting for OTP , Admin will Send Code after OTP comes.\n\n` +
      `Tap <b>🔑 Fetch OTP</b> to send a OTP request to the admin.`,
      {reply_markup:{inline_keyboard:[
        [{text:'🔄 Get OTP Again',callback_data:`fetch_password_${order.id}`,style:'success'}],
        [{text:'🔙 Main Menu',callback_data:'main_menu',style:'primary'}]
      ]}}
    );

    // Admin is informed that an order exists, but receives no password.
    const adminText =
      `🛒 <b>NEW ORDER</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 User: ${user.username ? '@' + user.username : user.firstName || 'Unknown'}\n` +
      `🆔 ID: <code>${userId}</code>\n` +
      `📦 Product: ${p.emoji || ''} ${p.name}\n` +
      `💰 Price: ₹${p.price} ($${usd})\n` +
      `📧 Email / Number: <code>${escapeHtml(deliveryItem.login)}</code>\n` +
      `📦 Remaining Stock: ${db.getProduct(pid).stock}\n` +
      `📋 Order ID: #${order.id}\n` +
      `📅 ${new Date().toLocaleString('en-IN')}\n\n` +
      `🔐 OTP will be sent only when the buyer requests it.`;

    try {
      await h._adminBot.sendMessage(ADMIN_CHAT, adminText, {
        parse_mode:'HTML',
        reply_markup:{inline_keyboard:[[
          {text:'✉️ Message User',callback_data:`msg_${userId}`,style:'primary'}
        ]]}
      });
    } catch (e) {
      console.error('[ORDER NOTIFY]', e.message);
    }
  } catch (e) {
    // If Telegram delivery fails, restore both the user's money and the stock item.
    db.restoreInventoryItem(pid, deliveryItem);
    db.updateUser(userId, { balance:user.balance, totalSpent:user.totalSpent || 0 });
    db.updateOrder(order.id, {status:'delivery_failed', error:e.message});
    console.error('[DELIVERY ERROR]', e.message);

    try {
      await h._adminBot.sendMessage(ADMIN_CHAT,
        `⚠️ <b>AUTO DELIVERY FAILED</b>\n\n` +
        `User: <code>${userId}</code>\n` +
        `Product: ${p.name}\n` +
        `Order: #${order.id}\n` +
        `Reason: ${escapeHtml(e.message)}`,
        {parse_mode:'HTML'}
      );
    } catch (_) {}

    return edit(chatId, msgId,
      `⚠️ <b>Delivery failed</b>\n\nYour balance was not charged and the stock item was restored. Please contact support.`,
      {reply_markup:{inline_keyboard:[[{text:'📞 Support',callback_data:'support',style:'primary'}]]}}
    );
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROFILE + LEADERBOARD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function showProfile(chatId, msgId, userId) {
  const user = db.getUser(userId);
  const rate = db.getDb().settings.usdtToInrRate || 90;
  return edit(chatId, msgId,
    `👤 <b>Your Profile</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
    `🆔 ID: <code>${userId}</code>\n` +
    `💰 Balance: ${h.formatBalance(user.balance)}\n` +
    `📥 Total Deposited: ₹${user.totalDeposited.toFixed(2)}\n` +
    `🔁 Deposit Count: ${user.depositCount}\n` +
    `🎁 Referrals: ${user.referralCount} (₹${user.referralEarned.toFixed(2)} earned)\n` +
    `📅 Joined: ${new Date(user.joinedAt).toLocaleDateString('en-IN')}`,
    { reply_markup:{inline_keyboard:[
      [{text:'🏆 Deposit Board',callback_data:'lb_dep',style:'primary'},{text:'🎁 Refer Board',callback_data:'lb_ref',style:'primary'}],
      [{text:'🔙 Back',callback_data:'main_menu',style:'primary'}],
    ]}}
  );
}

async function showLeaderboard(chatId, msgId, type) {
  const list  = type==='dep' ? db.getDepositLeaderboard(10) : db.getReferralLeaderboard(10);
  const title = type==='dep' ? '💰 Top Depositors' : '🎁 Top Referrers';
  const lines = list.m
