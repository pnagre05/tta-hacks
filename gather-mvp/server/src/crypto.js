// AES-256-GCM encryption for Google refresh tokens at rest.
const crypto = require('crypto');

function key() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY || '';
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  if (!key.warned) {
    console.warn('TOKEN_ENCRYPTION_KEY is not 64 hex chars; deriving one from JWT_SECRET (fine for a demo).');
    key.warned = true;
  }
  return crypto.createHash('sha256').update(process.env.JWT_SECRET || 'gather').digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString('base64')).join('.');
}

function decrypt(stored) {
  const [iv, tag, data] = stored.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
