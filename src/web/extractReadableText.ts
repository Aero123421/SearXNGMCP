import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export type ExtractedText = {
  title?: string;
  text: string;
};

export function extractReadableText(params: {
  html: string;
  url: string;
}): ExtractedText {
  const dom = new JSDOM(params.html, { url: params.url });
  const doc = dom.window.document;

  const reader = new Readability(doc);
  const article = reader.parse();

  const title = article?.title?.trim() || doc.title?.trim() || undefined;
  const text =
    article?.textContent?.trim() ||
    doc.body?.textContent?.trim() ||
    doc.documentElement?.textContent?.trim() ||
    "";

  return { title, text };
}

