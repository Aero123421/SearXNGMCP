export type ReadBodyResult = {
  text: string;
  truncated: boolean;
};

export async function readResponseTextUpTo(
  res: Response,
  maxBytes: number
): Promise<ReadBodyResult> {
  const body = res.body;
  if (!body) return { text: "", truncated: false };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    const remaining = maxBytes - total;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    if (value.byteLength > remaining) {
      chunks.push(value.subarray(0, remaining));
      total += remaining;
      truncated = true;
      break;
    }

    chunks.push(value);
    total += value.byteLength;
  }

  if (truncated) {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  return { text: decoder.decode(merged), truncated };
}

