import dns from 'dns';
import net from 'net';

/**
 * Checks whether an IP address belongs to RFC 1918 private subnets,
 * loopback, link-local (cloud metadata), or reserved address space.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 10.0.0.0/8 (RFC 1918 Private)
    if (parts[0] === 10) return true;
    // 172.16.0.0/12 (RFC 1918 Private)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (RFC 1918 Private)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (Link Local / Cloud Metadata 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 224.0.0.0/4 (Multicast)
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    // 240.0.0.0/4 (Reserved)
    if (parts[0] >= 240) return true;
    // 255.255.255.255 (Broadcast)
    if (ip === '255.255.255.255') return true;

    return false;
  } else if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // ::1 (Loopback)
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    // :: (Unspecified)
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
    // fc00::/7 (Unique Local Address)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    // fe80::/10 (Link-Local)
    if (normalized.startsWith('fe80') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;

    return false;
  }
  return true; // Unknown IP format, fail closed
}

/**
 * Validates endpoint URL against SSRF vulnerabilities:
 * - Restricts protocol to HTTP/HTTPS (requires HTTPS in production unless explicitly overridden)
 * - Resolves DNS and blocks private RFC 1918, loopback, and cloud metadata (169.254.169.254) IPs
 */
export async function validateEndpointUrl(urlString: string): Promise<{ valid: boolean; error?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  const allowHttp = process.env.ALLOW_HTTP_ENDPOINTS === 'true' || process.env.ALLOW_PRIVATE_ENDPOINTS === 'true' || process.env.NODE_ENV !== 'production';
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, error: 'Unsupported protocol. Only HTTP and HTTPS are permitted.' };
  }

  if (parsed.protocol === 'http:' && !allowHttp) {
    return { valid: false, error: 'Insecure HTTP protocol is disabled in production. Webhook URLs must use HTTPS.' };
  }

  const allowPrivate = process.env.ALLOW_PRIVATE_ENDPOINTS === 'true';
  const hostname = parsed.hostname;

  if (!allowPrivate) {
    if (hostname.toLowerCase() === 'localhost') {
      return { valid: false, error: 'SSRF Protection: Access to localhost is blocked.' };
    }

    try {
      const lookupResult = await dns.promises.lookup(hostname);
      if (isPrivateOrReservedIp(lookupResult.address)) {
        return {
          valid: false,
          error: `SSRF Protection: Destination resolved to private/reserved IP address (${lookupResult.address}). Access blocked.`
        };
      }
    } catch (err: any) {
      return { valid: false, error: `DNS resolution failed for hostname '${hostname}': ${err.message}` };
    }
  }

  return { valid: true };
}
