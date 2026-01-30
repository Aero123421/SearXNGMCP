export type SearchCursor = {
  page: number;
};

export function encodeCursor(cursor: SearchCursor): string {
  const json = JSON.stringify(cursor);
  return Buffer.from(json, "utf-8").toString("base64url");
}

export function decodeCursor(cursor: string): SearchCursor {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
  } catch {
    throw new Error("Invalid cursor");
  }
  if (!raw || typeof raw !== "object") throw new Error("Invalid cursor");
  const page = (raw as any).page;
  if (!Number.isInteger(page) || page < 1) throw new Error("Invalid cursor");
  return { page };
}

