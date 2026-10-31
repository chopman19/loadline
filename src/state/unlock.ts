// Whether this browser has unlocked Unlimited, and the calls to the payment functions.
import { API_BASE, LICENSE_PUBLIC_KEY } from '../config';
import { verifyLicense } from '../core/license';
import { persist, save } from './storage';

const UNAVAILABLE = 'Payments are unavailable right now. Please try again later.';

let unlocked: Promise<boolean> = verifyLicense(LICENSE_PUBLIC_KEY, save.license).then(Boolean);

export function isUnlocked(): Promise<boolean> {
  return unlocked;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error(UNAVAILABLE);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!data) throw new Error(UNAVAILABLE);
  if (!res.ok) throw new Error(data.error ?? UNAVAILABLE);
  return data;
}

/** Keeps a licence if its signature checks out. */
async function adopt(license: string): Promise<boolean> {
  if (!(await verifyLicense(LICENSE_PUBLIC_KEY, license))) return false;
  save.license = license;
  persist();
  unlocked = Promise.resolve(true);
  return true;
}

/** "€3.00", or null if the price can't be fetched. */
export async function priceLabel(): Promise<string | null> {
  try {
    const { amount, currency } = await api<{ amount: number | null; currency: string }>('checkout');
    if (amount === null) return null;
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
  } catch {
    return null;
  }
}

/** Sends the player to Stripe Checkout. They come back with ?unlock=<session id>. */
export async function startCheckout(): Promise<void> {
  const { url } = await api<{ url: string }>('checkout', { returnUrl: location.href });
  location.assign(url);
}

export async function restorePurchase(email: string): Promise<void> {
  const { license } = await api<{ license: string }>('restore', { email });
  if (!(await adopt(license))) throw new Error(UNAVAILABLE);
}

/**
 * Handles the return from Stripe Checkout. Returns null if this isn't a return,
 * true once the payment is confirmed and false if it couldn't be.
 */
export async function claimCheckoutReturn(): Promise<boolean | null> {
  const params = new URLSearchParams(location.search);
  const session = params.get('unlock');
  if (!session) return null;
  params.delete('unlock');
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  try {
    const { license } = await api<{ license: string }>(`verify?session=${encodeURIComponent(session)}`);
    return await adopt(license);
  } catch {
    return false;
  }
}
