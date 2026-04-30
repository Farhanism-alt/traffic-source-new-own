import { getRow, run } from '@/lib/db';
import { withAuth } from '@/lib/withAuth';

export default withAuth(async function handler(req, res) {
  const { id } = req.query;

  const site = await getRow('SELECT * FROM sites WHERE id = ? AND user_id = ?', [
    id,
    req.user.userId,
  ]);

  if (!site) {
    return res.status(404).json({ error: 'Site not found' });
  }

  if (req.method === 'GET') {
    const maskedSite = { ...site };
    if (maskedSite.stripe_secret_key) {
      maskedSite.stripe_secret_key = '••••' + maskedSite.stripe_secret_key.slice(-4);
    }
    if (maskedSite.stripe_webhook_secret) {
      maskedSite.stripe_webhook_secret = '••••' + maskedSite.stripe_webhook_secret.slice(-4);
    }
    if (maskedSite.dodo_api_key) {
      maskedSite.dodo_api_key = '••••' + maskedSite.dodo_api_key.slice(-4);
    }
    if (maskedSite.lemonsqueezy_api_key) {
      maskedSite.lemonsqueezy_api_key = '••••' + maskedSite.lemonsqueezy_api_key.slice(-4);
    }
    return res.status(200).json({ site: maskedSite });
  }

  if (req.method === 'PUT') {
    const { domain, name, stripe_secret_key, dodo_api_key, lemonsqueezy_api_key, is_public, public_slug } = req.body;
    const cleanDomain = domain
      ? domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
      : site.domain;

    await run('UPDATE sites SET domain = ?, name = ? WHERE id = ?', [
      cleanDomain,
      name || site.name,
      id,
    ]);

    if (stripe_secret_key !== undefined) {
      await run('UPDATE sites SET stripe_secret_key = ? WHERE id = ?', [
        stripe_secret_key || null,
        id,
      ]);
    }

    if (dodo_api_key !== undefined) {
      await run('UPDATE sites SET dodo_api_key = ? WHERE id = ?', [dodo_api_key || null, id]);
    }

    if (lemonsqueezy_api_key !== undefined) {
      await run('UPDATE sites SET lemonsqueezy_api_key = ? WHERE id = ?', [
        lemonsqueezy_api_key || null,
        id,
      ]);
    }

    if (is_public !== undefined) {
      if (is_public) {
        // Generate a slug if not provided
        let slug = public_slug;
        if (!slug) {
          slug = site.public_slug || site.domain.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        }
        slug = slug.replace(/[^a-z0-9-]/gi, '').toLowerCase();
        // Check uniqueness
        const existing = await getRow(
          'SELECT id FROM sites WHERE public_slug = ? AND id != ?',
          [slug, id]
        );
        if (existing) {
          return res.status(400).json({ error: 'This slug is already taken. Please choose a different one.' });
        }
        await run('UPDATE sites SET is_public = true, public_slug = ? WHERE id = ?', [slug, id]);
      } else {
        await run('UPDATE sites SET is_public = false WHERE id = ?', [id]);
      }
    } else if (public_slug !== undefined && site.is_public) {
      const slug = public_slug.replace(/[^a-z0-9-]/gi, '').toLowerCase();
      const existing = await getRow(
        'SELECT id FROM sites WHERE public_slug = ? AND id != ?',
        [slug, id]
      );
      if (existing) {
        return res.status(400).json({ error: 'This slug is already taken. Please choose a different one.' });
      }
      await run('UPDATE sites SET public_slug = ? WHERE id = ?', [slug, id]);
    }

    const updated = await getRow('SELECT * FROM sites WHERE id = ?', [id]);
    const maskedUpdated = { ...updated };
    if (maskedUpdated.stripe_secret_key) {
      maskedUpdated.stripe_secret_key = '••••' + maskedUpdated.stripe_secret_key.slice(-4);
    }
    if (maskedUpdated.stripe_webhook_secret) {
      maskedUpdated.stripe_webhook_secret = '••••' + maskedUpdated.stripe_webhook_secret.slice(-4);
    }
    if (maskedUpdated.dodo_api_key) {
      maskedUpdated.dodo_api_key = '••••' + maskedUpdated.dodo_api_key.slice(-4);
    }
    if (maskedUpdated.lemonsqueezy_api_key) {
      maskedUpdated.lemonsqueezy_api_key = '••••' + maskedUpdated.lemonsqueezy_api_key.slice(-4);
    }
    return res.status(200).json({ site: maskedUpdated });
  }

  if (req.method === 'DELETE') {
    await run('DELETE FROM sites WHERE id = ?', [id]);
    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
});
