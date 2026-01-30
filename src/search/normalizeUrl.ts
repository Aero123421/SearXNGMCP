const DROP_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src"
]);

export function normalizeUrlForDedup(urlString: string): string {
  try {
    const url = new URL(urlString);
    url.hash = "";
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }

    for (const key of Array.from(url.searchParams.keys())) {
      if (DROP_QUERY_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    // Normalize query param ordering
    const entries = Array.from(url.searchParams.entries());
    entries.sort(([aKey, aVal], [bKey, bVal]) => {
      const keyCmp = aKey.localeCompare(bKey);
      if (keyCmp !== 0) return keyCmp;
      return aVal.localeCompare(bVal);
    });
    url.search = "";
    for (const [k, v] of entries) url.searchParams.append(k, v);

    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return urlString.trim();
  }
}

