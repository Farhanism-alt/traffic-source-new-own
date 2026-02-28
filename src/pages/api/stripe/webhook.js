export default function handler(req, res) {
  res.status(410).json({
    error: 'This endpoint is deprecated. Use /api/stripe/webhook/[siteId] instead.',
  });
}
