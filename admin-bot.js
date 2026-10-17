// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// admin-bot.js — CLOUDE CART 🛒 | Admin Bot
// FIX: 409 conflict, join URL delete, ban system
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db  = require('./db');
const h   = require('./helpers');
const otpManager = require('./otp-manager');

const bot      = new TelegramBot(process.env.ADMIN_BOT_TOKEN, {
  polling: { interval: 1000, autoStart: true, params: { timeout: 10 } },
});
bot.on('polling_error', (err) => {
  const msg = err && (err.message || err.code || String(err));
  console.error('[admin polling_error]', msg);
});
bot.on('error', (err) => console.error('[admin error]', err && err.message));

const _answeredCb = new Set();
async function safeAnswer(q, opts) {
  if (!q || !q.id || _answeredCb.has(q.id)) return;
  _answeredCb.add(q.id);
  try { await bot.answerCallbackQuery(q.id, opts || {}); } catch (_) {}
  if (_answeredCb.size > 2000) {
    [..._answeredCb].slice(0, 1000).forEach((id) => _answeredCb.delete(id));
  }
}

const OWNER_ID = String(process.env.OWNER_ID);
const PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_CHAT = process.env.ADMIN_NOTIFY_CHAT_ID;

// Cross-bot setup — delayed so both files load first
let U = null;
setTimeout(() => {
  U = require('./user-bot');
  h.setBots(U.bot, bot);
}, 800);

// ── Auth ───────────────────────────────────────────────
const _auth = new Set();
function isAuth(id)  { return String(id)===OWNER_ID||db.isAdmin(String(id))||_auth.has(String(id)); }
function isOwner(id) { return String(id)===OWNER_ID; }

// ── Duplicate guard ────────────────────────────────────
const _seen = new Map();
function isDupe(id) {
  if (_seen.has(id)) return true;
  _seen.set(id,1); setTimeout(()=>_seen.delete(id),6000); return false;
}

const send = (c,t,o={}) => bot.sendMessage(c,t,{parse_mode:'HTML',...o});
async function edit(c,m,t,o={}) { try{await bot.editMessageText(t,{chat_id:c,message_id:m,parse_mode:'HTML',...o});}catch(_){} }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// /start
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
bot.onText(/\/start/, async (msg) => {
  const chatId=msg.chat.id; const userId=String(msg.from.id);
  if (!isAuth(userId)) {
    h.setAdminState(userId,'awaiting_password');
    return send(chatId,`🔐 <b>Welcome to NEXVAULT SHOP Admin Panel</b>\n\nEnter admin password:`);
  }
  _auth.add(userId);
  showPanel(chatId,null,userId);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEXT HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
bot.on('message', async (msg) => {
  if (!msg.text) return;
  if (msg.text.startsWith('/') && !(msg.text.trim()==='/skip' && h.getAdminState(String(msg.from.id)) && h.getAdminState(String(msg.from.id)).state==='prod_desc')) return;
  const chatId=msg.chat.id; const userId=String(msg.from.id);
  const state=h.getAdminState(userId);

  if (state && state.state==='awaiting_password') {
    if (msg.text.trim()===PASSWORD) { _auth.add(userId); h.clearAdminState(userId); return showPanel(chatId,null,userId); }
    return send(chatId,`❌ Wrong password. Try again:`);
  }
  if (!isAuth(userId)) return;
  if (!state) return;

  const t=msg.text; const d=state.data||{};
  switch(state.state) {
    case 'join_url':      return handleJoinUrl(chatId,userId,t,d);
    case 'join_name':     return handleJoinName(chatId,userId,t,d);
    case 'prod_name':     return handleProd(chatId,userId,'name',t,d);
    case 'prod_price':    return handleProd(chatId,userId,'price',t,d);
    case 'prod_stock':    return handleProd(chatId,userId,'stock',t,d);
    case 'prod_login':    return handleProd(chatId,userId,'login',t,d);
    case 'prod_password': return handleProd(chatId,userId,'password',t,d);
    case 'prod_emoji':    return handleProd(chatId,userId,'emoji',t,d);
    case 'prod_desc':     return handleProd(chatId,userId,'desc',t,d);
    case 'stock_qty':     return handleStockAdd(chatId,userId,'qty',t,d);
    case 'stock_login':   return handleStockAdd(chatId,userId,'login',t,d);
    case 'stock_password':return handleStockAdd(chatId,userId,'password',t,d);
    case 'upi_id':        return handleUpiId(chatId,userId,t,d);
    case 'upi_name':      return handleUpiName(chatId,userId,t,d);
    case 'bin_id':        return handleBinId(chatId,userId,t,d);
    case 'bin_name':      return handleBinName(chatId,userId,t,d);
    case 'support_user':  return handleSupportUser(chatId,userId,t);
    case 'rate':          return handleRate(chatId,userId,t);
    case 'min_dep':       return handleMinDep(chatId,userId,t);
    case 'hire_admin':    return handleHireAdmin(chatId,userId,t);
    case 'broadcast':     return handleBroadcast(chatId,userId,t);
    case 'flash_prod':    return handleFlashProd(chatId,userId,t,d);
    case 'flash_pct':     return handleFlashPct(chatId,userId,t,d);
    case 'flash_hrs':     return handleFlashHrs(chatId,userId,t,d);
    case 'ban_user':      return handleBanUser(chatId,userId,t);
    case 'unban_user':    return handleUnbanUser(chatId,userId,t);
    case 'msg_user':      return handleMsgUser(chatId,userId,t,d);
    case 'password_order': return handlePasswordOrder(chatId,userId,t,d);
    case 'tg_phone':      return handleTgPhone(chatId,userId,t,d);
    case 'tg_code':       return handleTgCode(chatId,userId,t,d);
    case 'tg_2fa':        return handleTg2fa(chatId,userId,t,d);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN PANEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── GramJS Add TG Number ─────────────────────────────────
const _tgWait = {}; // userId -> { codeResolve, passResolve }

async function handleTgPhone(chatId, userId, text, data) {
  const phone = String(text).replace(/\D/g, '');
  if (phone.length < 10) return send(chatId, 'Invalid phone. Example: +9198xxxxxxxx');
  const productId = data.productId;
  h.setAdminState(userId, 'tg_code', { productId, phone });
  _tgWait[userId] = {};
  const codePromise = new Promise((resolve) => { _tgWait[userId].codeResolve = resolve; });
  const passPromise = new Promise((resolve) => { _tgWait[userId].passResolve = resolve; });
  await send(chatId, `⏳ Connecting +${phone}...\nWhen Telegram sends the code, <b>type it here</b>.`, { parse_mode: 'HTML' });
  try {
    let twoFaPassword = '';
    const res = await otpManager.createSession(
      phone,
      async () => {
        await send(chatId, '📨 Send the OTP code now:');
        return await codePromise;
      },
      async () => {
        h.setAdminState(userId, 'tg_2fa', { productId, phone });
        await send(chatId, '🔐 2FA password required — send it (will be saved for buyer):');
        const p = await passPromise;
        twoFaPassword = String(p || '').trim();
        return p;
      }
    );
    db.addInventoryItems(productId, [{ id: Date.now() + '_tg', login: phone, password: twoFaPassword, addedAt: Date.now(), extra: 'gramjs_session' }]);
    h.clearAdminState(userId);
    delete _tgWait[userId];
    return send(chatId, `✅ Session saved for +${phone} (${res.name || ''})\nStock +1. Buyers will get auto OTP.`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Panel', callback_data: 'adm_panel', style: 'primary' }]] },
    });
  } catch (e) {
    h.clearAdminState(userId);
    delete _tgWait[userId];
    return send(chatId, `❌ ${e.message}`);
  }
}

async function handleTgCode(chatId, userId, text, data) {
  const w = _tgWait[userId];
  if (w && w.codeResolve) {
    w.codeResolve(text.trim());
    w.codeResolve = null;
    return send(chatId, '⏳ Signing in...');
  }
  return send(chatId, 'No pending code request. Start again from Add TG Number.');
}

async function handleTg2fa(chatId, userId, text, data) {
  const w = _tgWait[userId];
  if (w && w.passResolve) {
    w.passResolve(text.trim());
    w.passResolve = null;
    return send(chatId, '⏳ Submitting 2FA...');
  }
  return send(chatId, 'No pending 2FA request.');
}


async function showPanel(chatId,msgId,userId) {
  const text=`⚙️ <b>NEXVAULT SHOP — Admin Panel</b>\n\nChoose an option:`;
  const kb=[
    [{text:'🔗 Change Join URL',callback_data:'adm_join',style:'primary'},{text:'📦 Add Product',callback_data:'adm_add_prod',style:'success'}],
    [{text:'📋 Products',callback_data:'adm_prods',style:'primary'},{text:'💳 Deposit Settings',callback_data:'adm_dep_settings',style:'primary'}],
    [{text:'📥 Pending Deposits',callback_data:'adm_pending_dep',style:'primary'},{text:'🛒 Pending Orders',callback_data:'adm_pending_ord',style:'primary'}],
    [{text:'📱 Add TG Number (OTP)',callback_data:'adm_tg_otp',style:'success'}],
    [{text:'🔀 Feature Toggles',callback_data:'adm_toggles',style:'primary'},{text:'🔥 Flash Sale',callback_data:'adm_flash',style:'primary'}],
    [{text:'📢 Broadcast',callback_data:'adm_broadcast',style:'primary'},{text:'📞 Change Support',callback_data:'adm_support',style:'primary'}],
    [{text:'⚙️ Rate & Min Dep',callback_data:'adm_settings',style:'primary'},{text:'👥 Admins',callback_data:'adm_admins',style:'primary'}],
    [{text:'🚫 Ban / Unban User',callback_data:'adm_ban',style:'danger'}],
  ];
  if (msgId) return edit(chatId,msgId,text,{reply_markup:{inline_keyboard:kb}});
  return send(chatId,text,{reply_markup:{inline_keyboard:kb}});
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// JOIN URL — FIX: delete option added
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function showJoinMenu(chatId,msgId) {
  const links=db.getDb().settings.joinLinks;
  const text=`🔗 <b>Join URL Management</b>\n\n`+
    (links.length?links.map((l,i)=>`${i+1}. ${l.enabled?'🟢':'🔴'} <b>${l.name}</b>\n   ${l.url}`).join('\n\n'):'No links set yet.');
  const kb=[
    ...links.map((l,i)=>[
      {text:`✏️ Edit #${i+1}`,callback_data:`join_edit_${i}`,style:'primary'},
      {text:`${l.enabled?'🔴 Disable':'🟢 Enable'}`,callback_data:`join_toggle_${i}`,style:l.enabled?'danger':'success'},
      {text:`🗑️ Delete`,callback_data:`join_del_${i}`,style:'danger'},
    ]),
    [{text:'➕ Add New Link',callback_data:'join_add',style:'success'}],
    [{text:'🔙 Back',callback_data:'adm_panel',style:'primary'}],
  ];
  return edit(chatId,msgId,text,{reply_markup:{inline_keyboard:kb}});
}
async function handleJoinUrl(chatId,userId,text,data) {
  const db_=db.getDb();
  if (data.index!==undefined) db_.settings.joinLinks[data.index].url=text.trim();
  else db_.settings.joinLinks.push({name:'New Link',url:text.trim(),enabled:true});
  db.saveDb();
  const idx=data.index!==undefined?data.index:db_.settings.joinLinks.length-1;
  h.setAdminState(userId,'join_name',{index:idx});
  return send(chatId,`✅ URL saved! Now send the display name:`);
}
async function handleJoinName(chatId,userId,text,data) {
  const db_=db.getDb(); db_.settings.joinLinks[data.index].name=text.trim(); db.saveDb();
  h.clearAdminState(userId);
  return send(chatId,`✅ Join link updated!`,{reply_markup:{inline_keyboard:[[{text:'🔙 Panel',callback_data:'adm_panel',style:'primary'}]]}});
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRODUCTS — FIX: add/edit/delete all working
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const _draft={};

async function showProds(chatId,msgId,sessionMode=false) {
  const rate=db.getDb().settings.usdtToInrRate||90;
  const prods=db.listProducts(sessionMode);
  const title=sessionMode?'📂 Sessions':'📦 Accounts';
  const text=prods.length
    ?`${title}\n\n`+prods.map(p=>{const u=(p.price/rate).toFixed(2);return `${p.emoji||'📦'} ${p.name} | $${u} • ₹${p.price} | Stock: ${p.stock}`;}).join('\n')
    :`${title}\n\nNo products yet.`;
  const kb=[
    [{text:'📦 Accounts',callback_data:'prods_acc',style:'primary'},{text:'📂 Sessions',callback_data:'prods_ses',style:'primary'}],
    ...prods.map(p=>[{text:`${p.emoji||'📦'} ${p.name} — ₹${p.price}`,callback_data:`prod_${p.id}`,style:'primary'}]),
    [{text:'🔙 Back',callback_data:'adm_panel',style:'primary'}],
  ];
  return edit(chatId,msgId,text,{reply_markup:{inline_keyboard:kb}});
}

async function showProd(chatId,msgId,pid) {
  const p=db.getProduct(pid); if (!p) return;
  const rate=db.getDb().settings.usdtToInrRate||90; const u=(p.price/rate).toFixed(2);
  const text=`${p.emoji||'📦'} <b>${p.name}</b>\n\n💵 $${u} • ₹${p.price}\n📦 Stock: ${p.stock}\n📝 ${p.description||'No description'}\n🏷️ ${p.sessionMode?'Session':'Account'}\n\n🔐 Each stock item contains a separate Email/Number + Password.`;
  return edit(chatId,msgId,text,{reply_markup:{inline_keyboard:[
    [{text:'➕ Add Stock',callback_data:`stock_add_${pid}`,style:'success'}],
    [{text:'✏️ Edit',callback_data:`prod_edit_${pid}`,style:'primary'},{text:'🗑️ Delete',callback_data:`prod_del_${pid}`,style:'danger'}],
    [{text:'🔙 Back',callback_data:'adm_prods',style:'primary'}],
  ]}});
}

async function startAddProd(chatId,userId,sessionMode=false) {
  _draft[userId]={sessionMode:sessionMode,inventory:[]};
  h.setAdminState(userId,'prod_name',{sessionMode:sessionMode});
  return send(chatId,`📦 <b>Add Product</b>\n\nStep 1/6 — Enter product name:`);
}

async function handleProd(chatId,userId,field,text,data) {
  const d=_draft[userId]||{};
  if (field==='name') {
    d.name=text.trim(); _draft[userId]=d; h.setAdminState(userId,'prod_price',data);
    return send(chatId,data && data.editId ? `Step 2/4 — New price in ₹:` : `Step 2/6 — Price in ₹:`);
  }
  if (field==='price') {
    const price=parseFloat(text); if (isNaN(price)||price<=0) return send(chatId,`❌ Invalid price. Enter a positive number:`);
    d.price=price; _draft[userId]=d;
    if (data && data.editId) {
      h.setAdminState(userId,'prod_emoji',data);
      return send(chatId,`Step 3/4 — New emoji (send /skip to keep current):`);
    }
    h.setAdminState(userId,'prod_stock',data);
    return send(chatId,`Step 3/6 — How many stock accounts/items?\n\nExample: <code>3</code> means you must enter 3 separate Email/Number + Password pairs.`);
  }
  if (field==='stock') {
    const qty=parseInt(text,10);
    if (isNaN(qty)||qty<0) return send(chatId,`❌ Invalid quantity. Enter 0 or a positive whole number:`);
    d.stockTarget=qty; d.stockIndex=1; d.inventory=[]; _draft[userId]=d;
    if (qty===0) {
      h.setAdminState(userId,'prod_emoji',data);
      return send(chatId,`Step 4/6 — Emoji (e.g. 🇮🇳):`);
    }
    h.setAdminState(userId,'prod_login',data);
    return send(chatId,`🔐 <b>Stock item 1/${qty}</b>\n\nEnter Email / Number:`);
  }
  if (field==='login') {
    if (!text.trim()) return send(chatId,`❌ Email/Number cannot be empty. Enter it again:`);
    d.currentLogin=text.trim(); _draft[userId]=d; h.setAdminState(userId,'prod_password',data);
    return send(chatId,`🔑 Stock item ${d.stockIndex}/${d.stockTarget}\n\nEnter Password:`);
  }
  if (field==='password') {
    if (!text) return send(chatId,`❌ Password cannot be empty. Enter it again:`);
    d.inventory.push({id:String(Date.now())+'_'+d.stockIndex,login:d.currentLogin,password:text,addedAt:Date.now()});
    d.currentLogin=null;
    if (d.stockIndex < d.stockTarget) {
      d.stockIndex += 1; _draft[userId]=d; h.setAdminState(userId,'prod_login',data);
      return send(chatId,`🔐 <b>Stock item ${d.stockIndex}/${d.stockTarget}</b>\n\nEnter Email / Number:`);
    }
    _draft[userId]=d; h.setAdminState(userId,'prod_emoji',data);
    return send(chatId,`Step 4/6 — All ${d.stockTarget} stock items saved.\n\nEnter Emoji (e.g. 🇮🇳):`);
  }
  if (field==='emoji') {
    if (!(data && data.editId)) {
      d.emoji=text.trim(); _draft[userId]=d; h.setAdminState(userId,'prod_desc',data);
      return send(chatId,`Step 5/6 — Description (or /skip):`);
    }
    if (text.trim()!=='/skip') d.emoji=text.trim();
    _draft[userId]=d; h.setAdminState(userId,'prod_desc',data);
    return send(chatId,`Step 4/4 — New description (or /skip to keep current):`);
  }
  if (field==='desc') {
    if (data && data.editId) {
      if (text.trim()!=='/skip') d.description=text.trim();
      const ok=db.updateProduct(data.editId,{name:d.name,price:d.price,emoji:d.emoji,description:d.description});
      const prod=db.getProduct(data.editId);
      delete _draft[userId]; h.clearAdminState(userId);
      return send(chatId,ok?`✅ <b>Product updated!</b>\n\n${prod.emoji||'📦'} ${prod.name}\n₹${prod.price}\n📦 Stock: ${prod.stock}`:`❌ Product update failed.`,{reply_markup:{inline_keyboard:[[{text:'🔙 Products',callback_data:'adm_prods',style:'primary'}]]}});
    }
    d.description=text.trim()==='/skip'?null:text.trim();
    const prodData={name:d.name,price:d.price,emoji:d.emoji,description:d.description,sessionMode:!!d.sessionMode,inventory:d.inventory||[]};
    const prod=db.addProduct(prodData);
    delete _draft[userId]; h.clearAdminState(userId);
    const rate=db.getDb().settings.usdtToInrRate||90;
    return send(chatId,`✅ <b>Product added!</b>\n\n${prod.emoji||'📦'} ${prod.name}\n$${(prod.price/rate).toFixed(2)} • ₹${prod.price}\n📦 Stock: ${prod.stock}\n🔐 Credentials stored: ${prod.stock}`,
      {reply_markup:{inline_keyboard:[[{text:'🔙 Panel',callback_data:'adm_panel',style:'primary'}]]}});
  }
}

async function handleStockAdd(chatId,userId,field,text,data) {
  const d=_draft[userId]||{};
  if (field==='qty') {
    const qty=parseInt(text,10);
    if (isNaN(qty)||qty<1) return send(chatId,`❌ Enter a stock quantity of at least 1:`);
    d.stockTarget=qty; d.stockIndex=1; d.inventory=[]; _draft[userId]=d;
    h.setAdminState(userId,'stock_login',data);
    return send(chatId,`🔐 <b>New stock item 1/${qty}</b>\n\nEnter Email / Number:`);
  }
  if (field==='login') {
    if (!text.trim()) return send(chatId,`❌ Email/Number cannot be empty:`);
    d.currentLogin=text.trim(); _draft[userId]=d; h.setAdminState(userId,'stock_password',data);
    return send(chatId,`🔑 New stock item ${d.stockIndex}/${d.stockTarget}\n\nEnter Password:`);
  }
  if (field==='password') {
    if (!text) return send(chatId,`❌ Password cannot be empty:`);
    d.inventory.push({id:String(Date.now())+'_'+d.stockIndex,login:d.currentLogin,password:text,addedAt:Date.now()});
    if (d.stockIndex < d.stockTarget) {
      d.stockIndex += 1; _draft[userId]=d; h.setAdminState(userId,'stock_login',data);
      return send(chatId,`🔐 <b>New stock item ${d.stockIndex}/${d.stockTarget}</b>\n\nEnter Email / Number:`);
    }
    const ok=db.addInventoryItems(d.productId,d.inventory);
    delete _draft[userId]; h.clearAdminState(userId);
    const product=db.getProduct(d.productId);
    return send(chatId,ok?`✅ <b>Stock added successfully!</b>\n\n📦 ${product.name}\n➕ Added: ${d.stockTarget}\n📊 Total stock: ${product.stock}`:`❌ Could not add stock.`,{reply_markup:{inline_keyboard:[[{text:'🔙 Products',callback_data:'adm_prods',style:'primary'}]]}});
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEPOSIT SETTINGS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function showDepSettings(chatId,msgId) {
  const pay=db.getDb().settings.payments;
  return edit(chatId,msgId,`💳 <b>Deposit Settings</b>\n\nSelect payment method:`,{reply_markup:{inline_keyboard:[
    [{text:`📱 G Pay ${pay.gpay.enabled?'🟢':'🔴'}`,callback_data:'pay_gpay',style:pay.gpay.enabled?'success':'danger'},{text:`💳 Fam Pay ${pay.fampay.enabled?'🟢':'🔴'}`,callback_data:'pay_fampay',style:pay.fampay.enabled?'success':'danger'}],
    [{text:`🗃️ Any UPI ${pay.anyupi.enabled?'🟢':'🔴'}`,callback_data:'pay_anyupi',style:pay.anyupi.enabled?'success':'danger'},{text:`🏦 Binance ${pay.binance.enabled?'🟢':'🔴'}`,callback_data:'pay_binance',style:pay.binance.enabled?'success':'danger'}],
    [{text:'🔙 Back',callback_data:'adm_panel',style:'primary'}],
  ]}});
}

async function showPayMethod(chatId,msgId,method) {
  const pay=db.getDb().settings.payments[method];
  const names={gpay:'G Pay',fampay:'Fam Pay',anyupi:'Any UPI',binance:'Binance Pay'};
  const isBin=method==='binance';
  c
