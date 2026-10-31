// Shared code for the payment functions: a tiny Stripe REST client and licence issuing.
// Environment variables (set them in Netlify: Site configuration > Environment variables):
//   STRIPE_SECRET_KEY     sk_live_... (or sk_test_... while testing)
//   LICENSE_PRIVATE_KEY   the JSON key written to .env by `npm run keys`
//   STRIPE_PRODUCT_ID     optional; defaults to the Unlimited product below
import { signLicense } from '../../src/core/license';

const PRODUCT_ID = process.env.STRIPE_PRODUCT_ID || 'prod_VWptLN9ya187k9';

type Params = Record<string, string | number | undefined>;

export class ShopError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new ShopError(`Missing environment variable ${name}`);
  return v;
}

async function stripe<T>(path: string, params: Params = {}, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) query.append(k, String(v));
  const url = `https://api.stripe.com/v1/${path}${method === 'GET' && [...query].length ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' ? query : undefined,
  });
  const data = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) {
    console.error(`Stripe ${method} ${path}: ${data.error?.message ?? res.status}`);
    throw new ShopError(res.status === 404 ? 'Not found' : 'Payment provider error', res.status === 404 ? 404 : 502);
  }
  return data;
}

interface Price {
  id: string;
  type: 'one_time' | 'recurring';
  unit_amount: number | null;
  currency: string;
}

interface Session {
  id: string;
  url: string | null;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
}

/** The product's default price. Unlimited is a one-time purchase. */
export async function unlimitedPrice(): Promise<Price> {
  const product = await stripe<{ default_price: Price | null; active: boolean }>(`products/${PRODUCT_ID}`, { 'expand[]': 'default_price' });
  const price = product.default_price;
  if (!product.active || !price) throw new ShopError('The Unlimited product has no active price');
  if (price.type !== 'one_time') throw new ShopError('The Unlimited price must be a one-time price');
  return price;
}

export async function createCheckout(returnUrl: string): Promise<string> {
  const price = await unlimitedPrice();
  const back = new URL(returnUrl);
  back.search = '';
  back.hash = '';
  const session = await stripe<Session>(
    'checkout/sessions',
    {
      mode: 'payment',
      'line_items[0][price]': price.id,
      'line_items[0][quantity]': 1,
      success_url: `${back}?unlock={CHECKOUT_SESSION_ID}`,
      cancel_url: String(back),
      allow_promotion_codes: 'true',
    },
    'POST',
  );
  if (!session.url) throw new ShopError('Checkout could not be started');
  return session.url;
}

/** True if this completed session paid for the Unlimited product. */
async function paidForUnlimited(session: Session): Promise<boolean> {
  if (session.status !== 'complete' || session.payment_status === 'unpaid') return false;
  const items = await stripe<{ data: { price: { product: string } | null }[] }>(`checkout/sessions/${session.id}/line_items`, { limit: 100 });
  return items.data.some((li) => li.price?.product === PRODUCT_ID);
}

function issue(sessionId: string): Promise<string> {
  let key: JsonWebKey;
  try {
    key = JSON.parse(env('LICENSE_PRIVATE_KEY')) as JsonWebKey;
  } catch (e) {
    throw e instanceof ShopError ? e : new ShopError('LICENSE_PRIVATE_KEY is not valid JSON');
  }
  return signLicense(key, { v: 1, feature: 'unlimited', ref: sessionId, iat: Date.now() });
}

/** Licence for a Checkout Session the buyer has just returned from. */
export async function licenseForSession(sessionId: string): Promise<string> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new ShopError('Invalid session', 400);
  const session = await stripe<Session>(`checkout/sessions/${sessionId}`);
  if (!(await paidForUnlimited(session))) throw new ShopError('That payment isn’t complete', 402);
  return issue(session.id);
}

/** Licence for any earlier purchase made with this email address. */
export async function licenseForEmail(email: string): Promise<string> {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 254) throw new ShopError('Enter a valid email address', 400);
  const list = await stripe<{ data: Session[] }>('checkout/sessions', { 'customer_details[email]': clean, status: 'complete', limit: 100 });
  for (const session of list.data) if (await paidForUnlimited(session)) return issue(session.id);
  throw new ShopError('No purchase found for that email', 404);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/** Runs a handler and turns errors into JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ShopError) {
      if (e.status >= 500) console.error(e.message);
      return json({ error: e.status >= 500 ? 'Payments are unavailable right now' : e.message }, e.status);
    }
    console.error(e);
    return json({ error: 'Payments are unavailable right now' }, 500);
  }
}
