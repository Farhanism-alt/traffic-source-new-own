// Known AI crawlers, search engine bots, and training crawlers
export const CRAWLERS = [
  // === AI ANSWERS — user-triggered fetches ===
  { token: 'ChatGPT-User',        provider: 'OpenAI',      name: 'ChatGPT',          category: 'answers',  description: 'User-triggered fetches when ChatGPT opens a page to answer a person.' },
  { token: 'Claude-User',         provider: 'Anthropic',   name: 'Claude',            category: 'answers',  description: 'User-triggered fetches when Claude opens a page to answer a person.' },
  { token: 'Perplexity-User',     provider: 'Perplexity',  name: 'Perplexity',        category: 'answers',  description: 'User-triggered fetches for Perplexity answers and source citations.' },
  { token: 'Google-NotebookLM',   provider: 'Google',      name: 'NotebookLM',        category: 'answers',  description: 'Google fetcher associated with NotebookLM-style answer workflows.' },
  { token: 'Google-Read-Aloud',   provider: 'Google',      name: 'Google Read Aloud', category: 'answers',  description: 'Google fetcher associated with read-aloud and assistant experiences.' },
  { token: 'GoogleAgent',         provider: 'Google',      name: 'Google Agent',      category: 'answers',  description: 'Google user-triggered fetcher used by AI or product experiences.' },
  { token: 'Google-Agent',        provider: 'Google',      name: 'Google Agent',      category: 'answers',  description: 'Google user-triggered fetcher used by AI or product experiences.' },
  { token: 'MistralAI-User',      provider: 'Mistral',     name: 'Mistral',           category: 'answers',  description: 'MistralAI-User is tracked as a user-triggered fetcher from Mistral.' },
  { token: 'Copilot',             provider: 'Microsoft',   name: 'Copilot',           category: 'answers',  description: 'User-triggered Microsoft/Copilot fetches for AI answers.' },
  { token: 'Amzn-User',           provider: 'Amazon',      name: 'Amazon Alexa',      category: 'answers',  description: 'User-triggered Amazon fetches for fresh answers in products such as Alexa.' },
  { token: 'DuckAssistBot',       provider: 'DuckDuckGo',  name: 'DuckAssist',        category: 'answers',  description: 'DuckDuckGo real-time crawler for AI-assisted answers with citations.' },
  { token: 'xAI-SearchBot',       provider: 'xAI',         name: 'Grok Search',       category: 'answers',  description: 'xAI-SearchBot is tracked as a user-triggered fetcher from xAI.' },
  { token: 'Grok-DeepSearch',     provider: 'xAI',         name: 'Grok DeepSearch',   category: 'answers',  description: 'Grok-DeepSearch is tracked as a user-triggered fetcher from xAI.' },
  { token: 'meta-externalfetcher',provider: 'Meta',        name: 'Meta Fetcher',      category: 'answers',  description: 'Meta fetcher used when a person requests or shares a specific URL.' },
  { token: 'Kimi-User',           provider: 'Moonshot AI', name: 'Kimi',              category: 'answers',  description: 'Kimi-User is tracked as a user-triggered fetcher from Moonshot AI.' },
  { token: 'Qwen-User',           provider: 'Alibaba',     name: 'Qwen',              category: 'answers',  description: 'Qwen-User is tracked as a user-triggered fetcher from Alibaba.' },

  // === INDEXING — search engine crawlers ===
  { token: 'Googlebot',           provider: 'Google',          name: 'Googlebot',       category: 'indexing', description: "Google's main web crawler for indexing pages in Google Search." },
  { token: 'Bingbot',             provider: 'Microsoft',       name: 'Bingbot',         category: 'indexing', description: "Microsoft's web crawler for the Bing search index." },
  { token: 'msnbot',              provider: 'Microsoft',       name: 'MSNBot',          category: 'indexing', description: 'Microsoft legacy web crawler.' },
  { token: 'Applebot',            provider: 'Apple',           name: 'Applebot',        category: 'indexing', description: "Apple's web crawler for Siri and Spotlight suggestions." },
  { token: 'PerplexityBot',       provider: 'Perplexity',      name: 'PerplexityBot',   category: 'indexing', description: "Perplexity's indexing crawler for search and answer results." },
  { token: 'DuckDuckBot',         provider: 'DuckDuckGo',      name: 'DuckDuckBot',     category: 'indexing', description: "DuckDuckGo's web crawler for search indexing." },
  { token: 'YandexBot',           provider: 'Yandex',          name: 'YandexBot',       category: 'indexing', description: "Yandex's web crawler for the Russian search engine." },
  { token: 'Baiduspider',         provider: 'Baidu',           name: 'Baiduspider',     category: 'indexing', description: "Baidu's web crawler for the Chinese search engine." },
  { token: 'SemrushBot',          provider: 'Semrush',         name: 'SemrushBot',      category: 'indexing', description: 'Semrush web crawler for SEO analytics.' },
  { token: 'AhrefsBot',           provider: 'Ahrefs',          name: 'AhrefsBot',       category: 'indexing', description: 'Ahrefs web crawler for backlink and SEO data.' },
  { token: 'PetalBot',            provider: 'Huawei',          name: 'PetalBot',        category: 'indexing', description: 'Huawei Petal Search crawler.' },
  { token: 'Sogou',               provider: 'Sogou',           name: 'Sogoubot',        category: 'indexing', description: 'Sogou web crawler for Chinese search.' },
  { token: 'ia_archiver',         provider: 'Internet Archive',name: 'Wayback Machine', category: 'indexing', description: 'Internet Archive crawler for the Wayback Machine.' },
  { token: 'MJ12bot',             provider: 'Majestic',        name: 'Majestic',        category: 'indexing', description: 'Majestic web crawler for backlink data.' },

  // === TRAINING — model training data crawlers ===
  { token: 'GPTBot',              provider: 'OpenAI',      name: 'GPTBot',          category: 'training', description: "OpenAI's training crawler for collecting public content." },
  { token: 'ClaudeBot',           provider: 'Anthropic',   name: 'ClaudeBot',       category: 'training', description: "Anthropic's crawler for collecting public pages for training." },
  { token: 'anthropic-ai',        provider: 'Anthropic',   name: 'Anthropic',       category: 'training', description: 'Anthropic training data crawler.' },
  { token: 'Bytespider',          provider: 'ByteDance',   name: 'Bytespider',      category: 'training', description: 'ByteDance/TikTok training crawler for large-scale datasets.' },
  { token: 'CCBot',               provider: 'Common Crawl',name: 'CCBot',           category: 'training', description: 'Common Crawl open dataset crawler.' },
  { token: 'cohere-ai',           provider: 'Cohere',      name: 'Cohere',          category: 'training', description: 'Cohere AI training crawler.' },
  { token: 'FacebookBot',         provider: 'Meta',        name: 'FacebookBot',     category: 'training', description: 'Meta training crawler for collecting public content.' },
  { token: 'Diffbot',             provider: 'Diffbot',     name: 'Diffbot',         category: 'training', description: 'Diffbot structured data extraction crawler.' },
  { token: 'omgili',              provider: 'Webhose',     name: 'Omgili',          category: 'training', description: 'Webhose data aggregation crawler.' },

  // === OTHER AI bots ===
  { token: '0AI-AdsBot',          provider: 'OpenAI',   name: 'OpenAI Ads',     category: 'other', description: 'OpenAI crawler associated with ad or landing-page fetch workflows.' },
  { token: 'Google-CloudVertexBot',provider: 'Google',   name: 'Vertex AI',      category: 'other', description: 'Google Cloud Vertex AI crawler.' },
  { token: 'GrokBot',             provider: 'xAI',      name: 'GrokBot',        category: 'other', description: 'GrokBot is tracked as other AI bots from xAI.' },
  { token: 'xAI-Bot',             provider: 'xAI',      name: 'xAI Bot',        category: 'other', description: 'xAI-Bot is tracked as other AI bots from xAI.' },
  { token: 'xAI-Grok',            provider: 'xAI',      name: 'Grok',           category: 'other', description: 'xAI-Grok is tracked as other AI bots from xAI.' },
  { token: 'xAI-Web-Crawler',     provider: 'xAI',      name: 'xAI Crawler',    category: 'other', description: 'xAI-Web-Crawler is tracked as other AI bots from xAI.' },
  { token: 'Grok',                provider: 'xAI',      name: 'Grok',           category: 'other', description: 'Grok is tracked as other AI bots from xAI.' },
  { token: 'meta-externalads',    provider: 'Meta',     name: 'Meta Ads',       category: 'other', description: 'Meta crawler used for advertising and business product use cases.' },
  { token: 'facebookexternalhit', provider: 'Meta',     name: 'Facebook',       category: 'other', description: 'Meta crawler used for shared link previews on Facebook, Instagram, and Messenger.' },
  { token: 'Doubaobot',           provider: 'ByteDance',name: 'Doubao',         category: 'other', description: 'Doubaobot is tracked as other AI bots from ByteDance.' },
  { token: 'YiyanBot',            provider: 'Baidu',    name: 'Yiyan',          category: 'other', description: 'YiyanBot is tracked as other AI bots from Baidu.' },
];

export function detectCrawler(userAgent) {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  for (const crawler of CRAWLERS) {
    if (ua.includes(crawler.token.toLowerCase())) {
      return crawler;
    }
  }
  return null;
}
