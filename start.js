/**
 * Run User Bot + Admin Bot together
 */
require('dotenv').config();

process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e && e.message ? e.message : e);
});
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e && e.message ? e.message : e);
});

console.log('Starting User Bot + Admin Bot...');
console.log('Node', process.version);

if (!process.env.BOT_TOKEN || !process.env.ADMIN_BOT_TOKEN) {
  console.error('Missing BOT_TOKEN or ADMIN_BOT_TOKEN in .env');
  process.exit(1);
}

require('./user-bot');
require('./admin-bot');
console.log('Both bots polling. Press Ctrl+C to stop.');
