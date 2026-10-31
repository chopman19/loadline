// GET  /api/checkout  -> { amount, currency } for the Unlimited unlock
// POST /api/checkout  { returnUrl } -> { url } of a Stripe Checkout page
import { createCheckout, handle, json, ShopError, unlimitedPrice } from '../lib/shop';

export default (req: Request) =>
  handle(async () => {
    if (req.method === 'GET') {
      const price = await unlimitedPrice();
      return json({ amount: price.unit_amount, currency: price.currency });
    }
    if (req.method !== 'POST') throw new ShopError('Method not allowed', 405);
    const { returnUrl } = (await req.json().catch(() => ({}))) as { returnUrl?: string };
    // Only send buyers back to this site.
    let back: URL;
    try {
      back = new URL(String(returnUrl));
    } catch {
      throw new ShopError('Invalid return address', 400);
    }
    if (back.host !== new URL(req.url).host) throw new ShopError('Invalid return address', 400);
    return json({ url: await createCheckout(back.href) });
  });

export const config = { path: '/api/checkout' };
