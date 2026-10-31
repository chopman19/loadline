// GET /api/verify?session=cs_... -> { license } once Stripe confirms the payment
import { handle, json, licenseForSession } from '../lib/shop';

export default (req: Request) =>
  handle(async () => json({ license: await licenseForSession(new URL(req.url).searchParams.get('session') ?? '') }));

export const config = { path: '/api/verify' };
