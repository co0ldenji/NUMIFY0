# TG Shop Auto — Node.js + FamPay + GramJS OTP

## Features
- Original shop UI (user + admin dual bots)
- **FamPay Auto**: UPI QR + Gmail IMAP verify (no screenshot)
- **GramJS OTP**: Admin adds phone → session saved → buyer gets auto OTP from 777000
- Manual UPI screenshot still works

## Install
```bash
cd TG-Shop-Auto
npm install
cp .env.example .env
nano .env
node start.js
```

## .env
```
BOT_TOKEN=
ADMIN_BOT_TOKEN=
OWNER_ID=
ADMIN_PASSWORD=
ADMIN_NOTIFY_CHAT_ID=
API_ID=          # my.telegram.org
API_HASH=
FAMPAY_ENABLED=1
DEFAULT_UPI_ID=name@fam
DEFAULT_PAYEE_NAME=Your Name
IMAP_USERNAME=you@gmail.com
IMAP_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

## Admin: Add TG Number (OTP)
1. Create Account product (with stock qty you can add empty later)
2. Panel → **Add TG Number (OTP)** → select product
3. Send `+91...` → send login OTP → session in `sessions/`
4. User buys → number delivered → auto OTP in chat

## FamPay
Pay via QR → bot checks Gmail for FamApp mail with matching purpose → balance auto credit.

## systemd
```bash
WorkingDirectory=/root/TG-Shop-Auto
ExecStart=/usr/bin/node start.js
Restart=always
```
