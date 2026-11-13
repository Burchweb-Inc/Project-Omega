const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

module.exports = function createOidcSigner(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dataDir, 0o700);
  const keyPath = path.join(dataDir, '.oidc-signing-key.pem');
  let privateKeyPem = process.env.OIDC_SIGNING_KEY ? String(process.env.OIDC_SIGNING_KEY).replace(/\\n/g, '\n') : '';
  if (!privateKeyPem) {
    if (!fs.existsSync(keyPath)) {
      const pair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      fs.writeFileSync(keyPath, pair.privateKey, { mode: 0o600 });
    }
    fs.chmodSync(keyPath, 0o600);
    privateKeyPem = fs.readFileSync(keyPath, 'utf8');
  }

  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'rsa' || Number(privateKey.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
    throw new Error('The OIDC signing key must be an RSA private key of at least 2048 bits.');
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const kid = crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
  const publicJwk = {
    ...publicKey.export({ format: 'jwk' }),
    use: 'sig',
    alg: 'RS256',
    kid
  };

  function sign(claims) {
    const header = encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    const payload = encode(JSON.stringify(claims));
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
    return `${header}.${payload}.${signature}`;
  }

  return {
    publicKey,
    jwks: () => ({ keys: [publicJwk] }),
    sign
  };
};
