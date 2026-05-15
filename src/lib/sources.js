const DOMAIN_TO_SOURCE = {
  // Twitter / X
  't.co': 'X',
  'twitter.com': 'X',
  'x.com': 'X',
  // Instagram
  'instagram.com': 'Instagram',
  'l.instagram.com': 'Instagram',
  // Facebook
  'facebook.com': 'Facebook',
  'l.facebook.com': 'Facebook',
  'm.facebook.com': 'Facebook',
  'fb.com': 'Facebook',
  'fb.me': 'Facebook',
  // Reddit
  'reddit.com': 'Reddit',
  'old.reddit.com': 'Reddit',
  'out.reddit.com': 'Reddit',
  'redd.it': 'Reddit',
  // YouTube
  'youtube.com': 'YouTube',
  'm.youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  // LinkedIn
  'linkedin.com': 'LinkedIn',
  'lnkd.in': 'LinkedIn',
  // TikTok
  'tiktok.com': 'TikTok',
  'vm.tiktok.com': 'TikTok',
  // Pinterest
  'pinterest.com': 'Pinterest',
  'pin.it': 'Pinterest',
  // WhatsApp
  'wa.me': 'WhatsApp',
  'web.whatsapp.com': 'WhatsApp',
  // Telegram
  't.me': 'Telegram',
  // Hacker News
  'news.ycombinator.com': 'Hacker News',
  // Product Hunt
  'producthunt.com': 'Product Hunt',
  // Search engines
  'bing.com': 'Bing',
  'duckduckgo.com': 'DuckDuckGo',
  'yahoo.com': 'Yahoo',
  'yandex.com': 'Yandex',
  'baidu.com': 'Baidu',
};

export function normalizeSource(name) {
  if (!name || name === 'Direct') return name;
  const lower = name.toLowerCase().replace(/^www\./, '');
  if (/^google\./.test(lower)) return 'Google';
  return DOMAIN_TO_SOURCE[lower] || name;
}

// All raw domains that map to a given friendly name — used to expand DB filters
export function getSourceDomains(friendlyName) {
  return Object.entries(DOMAIN_TO_SOURCE)
    .filter(([, n]) => n === friendlyName)
    .map(([domain]) => domain);
}
