export type DetectedLang = "ja" | "en";

export function detectLanguageForQuery(query: string): DetectedLang {
  // Heuristic: if contains Japanese scripts, assume ja.
  if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(query)) return "ja";
  return "en";
}

