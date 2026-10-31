// POST /api/restore { email } -> { license } if that email bought Unlimited
import { handle, json, licenseForEmail, ShopError } from '../lib/shop';

export default (req: Request) =>
  handle(async () => {
    if (req.method !== 'POST') throw new ShopError('Method not allowed', 405);
    const { email } = (await req.json().catch(() => ({}))) as { email?: string };
    return json({ license: await licenseForEmail(String(email ?? '')) });
  });

export const config = { path: '/api/restore' };
