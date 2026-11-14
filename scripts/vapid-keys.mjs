// Generates a VAPID key pair for push notifications: node scripts/vapid-keys.mjs
// Then store them as Worker secrets (never commit them):
//   npx wrangler secret put VAPID_PUBLIC_KEY
//   npx wrangler secret put VAPID_PRIVATE_KEY
// For local dev, put both in .dev.vars (already git-ignored by wrangler conventions).
import { webcrypto } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const { publicKey, privateKey } = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = await webcrypto.subtle.exportKey("raw", publicKey);
const jwk = await webcrypto.subtle.exportKey("jwk", privateKey);

console.log(`VAPID_PUBLIC_KEY=${b64url(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
