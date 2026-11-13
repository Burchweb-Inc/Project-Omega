const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const keyPath = path.join(dataDir, '.task-encryption-key');

function loadKey() {
  if (process.env.TASK_ENCRYPTION_KEY) {
    const key = Buffer.from(process.env.TASK_ENCRYPTION_KEY, 'base64url');
    if (key.length !== 32) throw new Error('TASK_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    return key;
  }
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dataDir, 0o700);
  if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600 });
  fs.chmodSync(keyPath, 0o600);
  const key = fs.readFileSync(keyPath);
  if (key.length !== 32) throw new Error(`${keyPath} must contain exactly 32 bytes.`);
  return key;
}

const taskEncryptionKey = loadKey();

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', taskEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decrypt(storedValue, fallback = null) {
  if (!storedValue?.startsWith('v1:')) return JSON.parse(storedValue || JSON.stringify(fallback));
  const [, encodedIv, encodedTag, encodedCiphertext] = storedValue.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', taskEncryptionKey, Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, 'base64url')), decipher.final()]).toString('utf8'));
}

module.exports = { encrypt, decrypt };
