import dns from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { LRUCache } from "lru-cache";

const FORBIDDEN_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal"
]);

const FORBIDDEN_IPS = new Set([
  // Cloud / VM metadata endpoints
  "169.254.169.254",
  "100.100.100.200"
]);

function isForbiddenAddress(address: string): boolean {
  if (FORBIDDEN_IPS.has(address)) return true;
  try {
    const parsed = ipaddr.parse(address);
    const range = parsed.range();
    return (
      range === "unspecified" ||
      range === "loopback" ||
      range === "linkLocal" ||
      range === "uniqueLocal" ||
      range === "private" ||
      range === "multicast" ||
      range === "reserved" ||
      range === "broadcast" ||
      range === "carrierGradeNat"
    );
  } catch {
    return true;
  }
}

export class PublicWebUrlPolicy {
  private readonly dnsCache = new LRUCache<string, string[]>({
    max: 10_000,
    ttl: 10 * 60_000
  });

  async assertAllowed(url: URL): Promise<void> {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only http/https URLs are allowed");
    }
    if (url.username || url.password) {
      throw new Error("Userinfo in URL is not allowed");
    }

    const hostname = url.hostname.toLowerCase();
    if (!hostname) throw new Error("Missing hostname");
    if (FORBIDDEN_HOSTNAMES.has(hostname)) {
      throw new Error("Hostname is not allowed");
    }

    const port = url.port;
    if (port && port !== "80" && port !== "443") {
      throw new Error("Non-standard ports are not allowed");
    }

    if (isIP(hostname)) {
      if (isForbiddenAddress(hostname)) {
        throw new Error("IP address is not allowed");
      }
      return;
    }

    const cached = this.dnsCache.get(hostname);
    const addresses =
      cached ??
      (
        await dns.lookup(hostname, {
          all: true,
          verbatim: true
        })
      ).map((r) => r.address);

    if (addresses.length === 0) throw new Error("DNS lookup returned no results");
    this.dnsCache.set(hostname, addresses);

    for (const address of addresses) {
      if (isForbiddenAddress(address)) {
        throw new Error("Resolved IP address is not allowed");
      }
    }
  }
}

