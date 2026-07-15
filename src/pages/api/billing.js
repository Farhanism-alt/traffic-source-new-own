import { getRow, run } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';

async function ensureBillingColumns() {
  await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_activated_at TIMESTAMPTZ`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_license_key TEXT`).catch(() => {});
}

const PLANS = {
  free: { name: 'Free', price: 0 },
  pro: { name: 'Pro', price: 12 },
  business: { name: 'Business', price: 29 },
};

export default withAuth(async function handler(req, res) {
  await ensureBillingColumns();

  if (req.method === 'GET') {
    const user = await getRow(
      'SELECT plan, plan_activated_at, plan_license_key FROM users WHERE id = ?',
      [req.user.userId]
    );
    const plan = user?.plan || 'free';
    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.json({
      plan,
      planName: PLANS[plan]?.name || plan,
      price: PLANS[plan]?.price || 0,
      activatedAt: user?.plan_activated_at || null,
      hasLicenseKey: !!user?.plan_license_key,
    });
  }

  if (req.method === 'POST') {
    const { licenseKey, action } = req.body || {};

    if (action === 'deactivate') {
      await run(
        `UPDATE users SET plan = 'free', plan_activated_at = NULL, plan_license_key = NULL WHERE id = ?`,
        [req.user.userId]
      );
      return res.json({ plan: 'free', planName: 'Free' });
    }

    if (!licenseKey?.trim()) return res.status(400).json({ error: 'License key is required' });

    // Determine plan from key prefix: PRO- or BIZ-
    const key = licenseKey.trim();
    let newPlan = 'pro';
    if (key.toUpperCase().startsWith('BIZ-')) newPlan = 'business';

    await run(
      `UPDATE users SET plan = ?, plan_activated_at = NOW(), plan_license_key = ? WHERE id = ?`,
      [newPlan, key, req.user.userId]
    );

    return res.json({
      plan: newPlan,
      planName: PLANS[newPlan]?.name || newPlan,
      activatedAt: new Date().toISOString(),
    });
  }

  if (req.method === 'DELETE') {
    await run(
      `UPDATE users SET plan = 'free', plan_activated_at = NULL, plan_license_key = NULL WHERE id = ?`,
      [req.user.userId]
    );
    return res.json({ plan: 'free', planName: 'Free' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
