// Site-wide settings you may want to change when deploying.

/** Stripe Payment Link for the "Buy me a coffee" footer link. Leave empty to hide the link. */
export const COFFEE_URL = '';

/**
 * Public half of the key that signs Unlimited licences (made by `npm run keys`).
 * The private half lives only in the server's LICENSE_PRIVATE_KEY environment variable.
 */
export const LICENSE_PUBLIC_KEY: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'QAc_oDcOH41W5-Qk2GixQqi9zWwQrh9pQrOxud5u6TI',
  y: 'JOS7tt7biqaKTYb3hCnqEyrA9dhJs2O14kGDRTAZ2ME',
};

/** Where the payment functions live (see netlify/functions). */
export const API_BASE = '/api';
