import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../src/mcp/pagination.js";

describe("pagination cursor", () => {
  it("encodes and decodes page", () => {
    const encoded = encodeCursor({ page: 3 });
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual({ page: 3 });
  });

  it("rejects invalid cursor", () => {
    expect(() => decodeCursor("not-base64")).toThrow(/Invalid cursor/);
  });
});

