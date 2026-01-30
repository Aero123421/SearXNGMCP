import { normalizeUrlForDedup } from "./normalizeUrl.js";

export type RankedSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  score: number;
  domain?: string;
};

function domainMatches(domain: string, rule: string): boolean {
  const r = rule.toLowerCase();
  if (domain === r) return true;
  return domain.endsWith(`.${r}`);
}

export function domainFromUrl(urlString: string): string | undefined {
  try {
    const url = new URL(urlString);
    return url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/u)
    .filter((t) => t.length >= 2);
}

export function rerank(params: {
  query: string;
  results: Array<{
    title: string;
    url: string;
    snippet?: string;
    source?: string;
    rawScore?: number;
  }>;
  techDomainBoost: string[];
  extraBoostDomains?: string[];
  includeDomains?: string[];
  excludeDomains?: string[];
}): RankedSearchResult[] {
  const queryTokens = new Set(tokenize(params.query));
  const include = params.includeDomains?.map((d) => d.toLowerCase());
  const exclude = params.excludeDomains?.map((d) => d.toLowerCase());

  const techBoost = params.techDomainBoost.map((d) => d.toLowerCase());
  const extraBoost = (params.extraBoostDomains ?? []).map((d) => d.toLowerCase());

  const seen = new Set<string>();
  const scored: RankedSearchResult[] = [];

  for (const item of params.results) {
    const normalizedUrl = normalizeUrlForDedup(item.url);
    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);

    const domain = domainFromUrl(item.url);
    if (domain) {
      if (exclude?.some((d) => domainMatches(domain, d))) continue;
      if (include && !include.some((d) => domainMatches(domain, d))) continue;
    }

    const titleTokens = new Set(tokenize(item.title));
    const snippetTokens = new Set(tokenize(item.snippet ?? ""));

    // SearXNG/engine scores are not normalized across engines; treat as a weak signal.
    let score = (item.rawScore ?? 0) / 10;

    for (const t of queryTokens) {
      if (titleTokens.has(t)) score += 3;
      else if (snippetTokens.has(t)) score += 1;
    }

    if (domain && techBoost.some((d) => domainMatches(domain, d))) score += 5;
    if (domain && extraBoost.some((d) => domainMatches(domain, d))) score += 4;
    if (domain && (domain.startsWith("docs.") || domain.includes("developer."))) score += 2;
    if (item.url.includes("/docs") || item.url.includes("/documentation")) score += 1;

    if (domain && domainMatches(domain, "pinterest.com")) score -= 10;
    if (domain && domainMatches(domain, "quora.com")) score -= 6;

    scored.push({
      title: item.title,
      url: normalizedUrl,
      snippet: item.snippet,
      source: item.source,
      score,
      domain
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
