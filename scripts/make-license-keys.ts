// Creates the key pair that signs Unlimited licences.
// - The public key is written into src/config.ts (it ships with the game).
// - The private key is written to .env as LICENSE_PRIVATE_KEY. Copy it into your host's
//   environment variables; never commit it.
// Making new keys invalidates every licence already sold, so this refuses to overwrite
// an existing key unless you pass --force.
// Usage: npm run keys [-- --force]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateLicenseKeys } from '../src/core/license';

const ENV = '.env';
const CONFIG = 'src/config.ts';
const env = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
if (/^LICENSE_PRIVATE_KEY=/m.test(env) && !process.argv.includes('--force')) {
  console.error('.env already has LICENSE_PRIVATE_KEY. New keys would invalidate every existing licence.\nRun with --force if you really mean it.');
  process.exit(1);
}

const { publicJwk, privateJwk } = await generateLicenseKeys();

const line = `LICENSE_PRIVATE_KEY=${JSON.stringify(privateJwk)}`;
writeFileSync(ENV, /^LICENSE_PRIVATE_KEY=/m.test(env) ? env.replace(/^LICENSE_PRIVATE_KEY=.*$/m, line) : `${env}${env && !env.endsWith('\n') ? '\n' : ''}${line}\n`);

const config = readFileSync(CONFIG, 'utf8');
const block = /export const LICENSE_PUBLIC_KEY: JsonWebKey = \{[^}]*\};/;
if (!block.test(config)) throw new Error(`LICENSE_PUBLIC_KEY not found in ${CONFIG}`);
writeFileSync(
  CONFIG,
  config.replace(block, `export const LICENSE_PUBLIC_KEY: JsonWebKey = {\n  kty: 'EC',\n  crv: 'P-256',\n  x: '${publicJwk.x}',\n  y: '${publicJwk.y}',\n};`),
);
console.log(`Wrote the public key to ${CONFIG} and the private key to ${ENV}.`);
