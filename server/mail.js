'use strict';
const nodemailer = require('nodemailer');
const localDev = process.env.NODE_ENV === 'development' && (() => {
  try { return ['localhost', '127.0.0.1'].includes(new URL(process.env.BASE_URL || '').hostname); } catch { return false; }
})();
const smtpReady = !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
const transport = smtpReady ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
}) : null;
async function send(to, subject, text) {
  if (transport) return transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
  if (localDev) { console.log('\n[LOCAL DEVELOPMENT EMAIL — NEVER USE IN PRODUCTION]\nTo:', to, '\nSubject:', subject, '\n', text, '\n'); return; }
  throw new Error('SMTP is not configured. Sign-in emails cannot be sent.');
}
module.exports = { send, smtpReady, localDev };
