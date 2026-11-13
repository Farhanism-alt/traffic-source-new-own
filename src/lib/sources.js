const DOMAIN_TO_SOURCE = {
  // Twitter / X
  't.co': 'X',
  'twitter.com': 'X',
  'x.com': 'X',
  // Instagram
  'instagram.com': 'Instagram',
  'lm.instagram.com': 'Instagram',
  'threads.net': 'Threads',
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
  'ecosia.org': 'Ecosia',
  'search.brave.com': 'Brave Search',
  'startpage.com': 'Startpage',
  'mail.google.com': 'Gmail',
  // AI Engines & Chatbots
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'perplexity.ai': 'Perplexity',
  'gemini.google.com': 'Google Gemini',
  'copilot.microsoft.com': 'Copilot',
  'grok.com': 'Grok',
  'x.ai': 'Grok',
};

// Android apps send android-app://<package>/ as the referrer
const ANDROID_APP_TO_SOURCE = {
  'com.google.android.googlequicksearchbox': 'Google',
  'com.google.android.gm': 'Gmail',
  'com.google.android.youtube': 'YouTube',
  'com.instagram.android': 'Instagram',
  'com.facebook.katana': 'Facebook',
  'com.facebook.orca': 'Facebook',
  'com.twitter.android': 'X',
  'com.linkedin.android': 'LinkedIn',
  'com.reddit.frontpage': 'Reddit',
  'com.whatsapp': 'WhatsApp',
  'org.telegram.messenger': 'Telegram',
  'com.slack': 'Slack',
  'com.discord': 'Discord',
  'com.pinterest': 'Pinterest',
  'com.zhiliaoapp.musically': 'TikTok',
};

/**
 * Friendly name for a referrer domain or utm_source value: chatgpt.com → ChatGPT,
 * in.search.yahoo.com → Yahoo, ig → Instagram, Android app ids → the app. Unknown values pass through.
 */
export function normalizeSource(name) {
  if (!name || name === 'Direct') return name;
  const lower = String(name).toLowerCase().trim().replace(/^www\./, '');
  if (ANDROID_APP_TO_SOURCE[lower]) return ANDROID_APP_TO_SOURCE[lower];
  if (DOMAIN_TO_SOURCE[lower]) return DOMAIN_TO_SOURCE[lower];
  if (/^google\./.test(lower)) return 'Google';
  // Subdomains of a known site: in.search.yahoo.com → yahoo.com, m.reddit.com → reddit.com
  const parts = lower.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const d = parts.slice(i).join('.');
    if (DOMAIN_TO_SOURCE[d]) return DOMAIN_TO_SOURCE[d];
  }
  if (Object.prototype.hasOwnProperty.call(TOKEN_TO_SOURCE, lower)) return TOKEN_TO_SOURCE[lower];
  return name;
}

/** Registrable domain, roughly: www.app.example.co.uk → example.co.uk, app.inspoai.io → inspoai.io */
export function rootDomain(host) {
  const bare = String(host || '').toLowerCase().trim().replace(/^[a-z]+:\/\//, '').split('/')[0].split(':')[0];
  const parts = bare.replace(/\.$/, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2];
  const tld = parts[parts.length - 1];
  const take = tld.length === 2 && ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or'].includes(sld) ? 3 : 2;
  return parts.slice(-take).join('.');
}

// All raw domains that map to a given friendly name — used to expand DB filters
export function getSourceDomains(friendlyName) {
  const pick = (map) => Object.entries(map).filter(([, n]) => n === friendlyName).map(([k]) => k);
  return [...new Set([
    ...pick(DOMAIN_TO_SOURCE),
    ...pick(DOMAIN_TO_SOURCE).map((d) => `www.${d}`),
    ...pick(ANDROID_APP_TO_SOURCE),
    ...pick(TOKEN_TO_SOURCE),
  ])];
}

// ---- Source types: AI / Search / Social / Referral / Direct ----------------

const AI_SOURCES = ['ChatGPT', 'Claude', 'Perplexity', 'Google Gemini', 'Copilot', 'Grok'];
const SEARCH_SOURCES = ['Google', 'Bing', 'DuckDuckGo', 'Yahoo', 'Yandex', 'Baidu', 'Ecosia', 'Brave Search', 'Startpage'];
const SOCIAL_SOURCES = ['X', 'Instagram', 'Facebook', 'Reddit', 'YouTube', 'LinkedIn', 'TikTok', 'Pinterest', 'WhatsApp', 'Telegram', 'Hacker News', 'Product Hunt', 'Threads', 'Discord', 'Slack'];

// Bare utm_source values people commonly use (utm_source=reddit, utm_source=chatgpt.com, ...)
const AI_TOKENS = ['chatgpt', 'openai', 'claude', 'anthropic', 'perplexity', 'gemini', 'copilot', 'grok', 'deepseek', 'mistral', 'you.com', 'phind'];
const SEARCH_TOKENS = ['google', 'bing', 'duckduckgo', 'yahoo', 'yandex', 'baidu', 'ecosia', 'brave', 'startpage'];
const SOCIAL_TOKENS = ['reddit', 'twitter', 'x', 'facebook', 'fb', 'instagram', 'ig', 'linkedin', 'youtube', 'tiktok', 'pinterest', 'whatsapp', 'telegram', 'hackernews', 'hacker news', 'producthunt', 'product hunt', 'threads', 'discord', 'quora', 'medium'];

export const SOURCE_TYPES = ['AI', 'Search', 'Social', 'Referral', 'Direct'];

function domainsFor(names) {
  return Object.entries(DOMAIN_TO_SOURCE).filter(([, n]) => names.includes(n)).map(([d]) => d);
}

/** Classify a raw source (utm_source or referrer domain) or a friendly name. */
export function sourceType(raw) {
  if (!raw || raw === 'Direct') return 'Direct';
  const friendly = normalizeSource(raw);
  if (AI_SOURCES.includes(friendly)) return 'AI';
  if (SEARCH_SOURCES.includes(friendly)) return 'Search';
  if (SOCIAL_SOURCES.includes(friendly)) return 'Social';
  const lower = String(raw).toLowerCase().replace(/^www\./, '');
  const base = lower.split('.')[0];
  if (AI_TOKENS.some((t) => lower === t || base === t || lower.startsWith(`${t}.`))) return 'AI';
  if (SEARCH_TOKENS.some((t) => lower === t || base === t)) return 'Search';
  if (SOCIAL_TOKENS.some((t) => lower === t || base === t)) return 'Social';
  return 'Referral';
}

/** Same classification as sourceType(), as a SQL CASE over a text expression. */
export function sourceTypeSql(expr) {
  const v = `LOWER(REGEXP_REPLACE(COALESCE(${expr}, ''), '^www\\.', ''))`;
  const b = `SPLIT_PART(${v}, '.', 1)`;
  const list = (arr) => arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
  const ai = [...domainsFor(AI_SOURCES), ...AI_TOKENS];
  const search = [...domainsFor(SEARCH_SOURCES), ...SEARCH_TOKENS];
  const social = [...domainsFor(SOCIAL_SOURCES), ...SOCIAL_TOKENS];
  return `(CASE
    WHEN ${v} = '' OR ${v} = 'direct' THEN 'Direct'
    WHEN ${v} IN (${list(ai)}) OR ${b} IN (${list(AI_TOKENS)}) OR ${v} = 'gemini.google.com' THEN 'AI'
    WHEN ${v} IN (${list(search)}) OR ${b} IN (${list(SEARCH_TOKENS)}) OR ${v} LIKE 'google.%' THEN 'Search'
    WHEN ${v} IN (${list(social)}) OR ${b} IN (${list(SOCIAL_TOKENS)}) THEN 'Social'
    ELSE 'Referral' END)`;
}

// Bare utm_source spellings → the friendly names used for referrer domains.
const TOKEN_TO_SOURCE = {
  reddit: 'Reddit', twitter: 'X', x: 'X', facebook: 'Facebook', fb: 'Facebook', instagram: 'Instagram', ig: 'Instagram', insta: 'Instagram',
  threads: 'Threads', discord: 'Discord', gmail: 'Gmail', newsletter: 'Newsletter', email: 'Email',
  linkedin: 'LinkedIn', youtube: 'YouTube', tiktok: 'TikTok', pinterest: 'Pinterest', whatsapp: 'WhatsApp', telegram: 'Telegram',
  hackernews: 'Hacker News', 'hacker news': 'Hacker News', hn: 'Hacker News', producthunt: 'Product Hunt', 'product hunt': 'Product Hunt',
  google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', yandex: 'Yandex', baidu: 'Baidu',
  chatgpt: 'ChatGPT', openai: 'ChatGPT', claude: 'Claude', perplexity: 'Perplexity', gemini: 'Google Gemini', copilot: 'Copilot', grok: 'Grok',
};

/** Kept for callers: normalizeSource() now also folds bare utm_source values (reddit, ig, chatgpt, ...). */
export function friendlySourceName(raw) {
  if (!raw || raw === 'Direct') return 'Direct';
  return normalizeSource(raw);
}
