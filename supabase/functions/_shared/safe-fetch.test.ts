// Deno test for the pure IP-classification logic behind the SSRF guard.
// Run with: deno test supabase/functions/_shared/safe-fetch.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isPrivateAddress } from "./safe-fetch.ts";

const PRIVATE_V4: string[] = [
  "0.0.0.0", // this-network /8
  "0.255.255.255",
  "10.0.0.0", // RFC1918 /8
  "10.1.2.3",
  "10.255.255.255",
  "100.64.0.0", // CGNAT /10
  "100.100.0.1",
  "100.127.255.255",
  "127.0.0.1", // loopback /8
  "127.255.255.255",
  "169.254.0.1", // link-local /16
  "169.254.169.254", // cloud metadata endpoint
  "172.16.0.1", // RFC1918 /12
  "172.31.255.255",
  "192.168.0.1", // RFC1918 /16
  "192.168.255.255",
  "224.0.0.1", // multicast /4
  "239.255.255.255",
  "240.0.0.1", // reserved /4
  "255.255.255.255",
];

const PUBLIC_V4: string[] = [
  "8.8.8.8",
  "1.1.1.1",
  "93.184.216.34",
  "172.15.255.255", // just below 172.16/12
  "172.32.0.0", // just above 172.16/12
  "100.63.255.255", // just below 100.64/10
  "100.128.0.0", // just above 100.64/10
  "9.255.255.255", // just below 10/8
  "11.0.0.0", // just above 10/8
];

const PRIVATE_V6: string[] = [
  "::1", // loopback
  "::", // unspecified
  "fc00::1", // unique local /7
  "fd12:3456:789a::1", // unique local /7
  "fe80::1", // link-local /10
  "fe80::abcd:1234:5678:9abc", // link-local /10
  "febf:ffff::1", // top of fe80::/10 range
  "::ffff:127.0.0.1", // IPv4-mapped loopback
  "::ffff:169.254.1.1", // IPv4-mapped link-local
  "::ffff:10.0.0.1", // IPv4-mapped RFC1918
  "0:0:0:0:0:ffff:a00:1", // ::ffff:10.0.0.1 written out fully
];

const PUBLIC_V6: string[] = [
  "2001:4860:4860::8888", // Google public DNS
  "2606:4700:4700::1111", // Cloudflare public DNS
  "::ffff:8.8.8.8", // IPv4-mapped public address
  "fec0::1", // just above fe80::/10 range (site-local, deprecated but not fe80/10)
];

Deno.test("isPrivateAddress: blocks every required IPv4 range", () => {
  for (const ip of PRIVATE_V4) {
    assertEquals(isPrivateAddress(ip), true, `expected ${ip} to be private`);
  }
});

Deno.test("isPrivateAddress: allows public IPv4 addresses", () => {
  for (const ip of PUBLIC_V4) {
    assertEquals(isPrivateAddress(ip), false, `expected ${ip} to be public`);
  }
});

Deno.test("isPrivateAddress: blocks every required IPv6 range", () => {
  for (const ip of PRIVATE_V6) {
    assertEquals(isPrivateAddress(ip), true, `expected ${ip} to be private`);
  }
});

Deno.test("isPrivateAddress: allows public IPv6 addresses", () => {
  for (const ip of PUBLIC_V6) {
    assertEquals(isPrivateAddress(ip), false, `expected ${ip} to be public`);
  }
});

Deno.test("isPrivateAddress: non-IP strings are not classified as private", () => {
  assertEquals(isPrivateAddress("example.com"), false);
  assertEquals(isPrivateAddress("not-an-ip"), false);
  assertEquals(isPrivateAddress(""), false);
});
