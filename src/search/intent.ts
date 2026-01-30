export type QueryIntent =
  | "general"
  | "tech"
  | "hardware"
  | "history"
  | "images";

export function detectIntent(query: string): QueryIntent {
  const q = query.toLowerCase();

  if (/(画像|image|photo|jpg|jpeg|png|gif|svg|webp)/i.test(query)) return "images";
  if (/(gpu|cpu|rtx|radeon|geforce|intel|amd|nvidia|arm|soc|benchmark|tflops|vrm)/i.test(q))
    return "hardware";
  if (
    /(exception|stack trace|segfault|panic|error|npm|pip|cargo|tsc|docker|kubernetes|k8s|api|sdk|http|ssl|tls)/i.test(
      q
    )
  )
    return "tech";
  if (/(歴史|年表|戦争|王朝|紀元前|revolution|dynasty|timeline|history)/i.test(query))
    return "history";

  return "general";
}

export function intentBoostDomains(intent: QueryIntent): string[] {
  switch (intent) {
    case "hardware":
      return [
        "anandtech.com",
        "tomshardware.com",
        "wikipedia.org",
        "techpowerup.com",
        "arstechnica.com",
        "developer.nvidia.com",
        "amd.com",
        "intel.com"
      ];
    case "tech":
      return [
        "developer.mozilla.org",
        "learn.microsoft.com",
        "docs.microsoft.com",
        "docs.oracle.com",
        "cloudflare.com",
        "kubernetes.io",
        "nodejs.org",
        "python.org",
        "pypi.org",
        "npmjs.com",
        "github.com",
        "gitlab.com",
        "stackoverflow.com"
      ];
    case "history":
      return ["wikipedia.org", "britannica.com", "archives.gov", "nationalarchives.gov.uk"];
    case "images":
      return [];
    case "general":
      return [];
  }
}

