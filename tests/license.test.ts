import { describe, expect, it } from 'vitest';
import { generateLicenseKeys, signLicense, verifyLicense, type LicensePayload } from '../src/core/license';

const payload: LicensePayload = { v: 1, feature: 'unlimited', ref: 'cs_test_123', iat: 1_793_000_000_000 };

describe('licences', () => {
  it('verifies a licence signed with the matching key', async () => {
    const { publicJwk, privateJwk } = await generateLicenseKeys();
    const token = await signLicense(privateJwk, payload);
    expect(await verifyLicense(publicJwk, token)).toEqual(payload);
  });

  it('rejects licences signed with another key', async () => {
    const mine = await generateLicenseKeys();
    const theirs = await generateLicenseKeys();
    expect(await verifyLicense(mine.publicJwk, await signLicense(theirs.privateJwk, payload))).toBeNull();
  });

  it('rejects edited licences', async () => {
    const { publicJwk, privateJwk } = await generateLicenseKeys();
    const [, sig] = (await signLicense(privateJwk, payload)).split('.');
    const forged = btoa(JSON.stringify({ ...payload, ref: 'cs_forged' })).replace(/=+$/, '');
    expect(await verifyLicense(publicJwk, `${forged}.${sig}`)).toBeNull();
  });

  it('rejects junk without throwing', async () => {
    const { publicJwk } = await generateLicenseKeys();
    for (const junk of [null, undefined, '', 'true', 'a.b', 'a.b.c', '{"feature":"unlimited"}']) {
      expect(await verifyLicense(publicJwk, junk)).toBeNull();
    }
  });

  it('never ships the private key', async () => {
    const { publicJwk } = await generateLicenseKeys();
    expect(publicJwk).not.toHaveProperty('d');
  });
});
