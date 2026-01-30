import { describe, expect, it } from "vitest";
import { PublicWebUrlPolicy } from "../src/security/urlPolicy.js";

describe("PublicWebUrlPolicy", () => {
  it("blocks localhost", async () => {
    const policy = new PublicWebUrlPolicy();
    await expect(policy.assertAllowed(new URL("http://127.0.0.1/"))).rejects.toThrow();
    await expect(policy.assertAllowed(new URL("http://localhost/"))).rejects.toThrow();
  });

  it("blocks metadata endpoints", async () => {
    const policy = new PublicWebUrlPolicy();
    await expect(policy.assertAllowed(new URL("http://169.254.169.254/"))).rejects.toThrow();
  });

  it("allows public IP on standard port", async () => {
    const policy = new PublicWebUrlPolicy();
    await expect(policy.assertAllowed(new URL("https://1.1.1.1/"))).resolves.toBeUndefined();
  });

  it("blocks non-standard ports", async () => {
    const policy = new PublicWebUrlPolicy();
    await expect(policy.assertAllowed(new URL("https://1.1.1.1:8443/"))).rejects.toThrow();
  });
});

