import dns from 'dns';
import net from 'net';
import http from 'http';
import https from 'https';

/**
 * Checks whether an IP address belongs to RFC 1918 private subnets,
 * loopback, link-local (cloud metadata), IPv4-mapped IPv6, or reserved address space.
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

    // IPv4-mapped IPv6 addresses (e.g., ::ffff:127.0.0.1, ::ffff:169.254.169.254)
    if (normalized.startsWith('::ffff:')) {
      const ipv4Part = normalized.slice(7);
      return isPrivateOrReservedIp(ipv4Part);
    }

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
 * - Resolves all DNS records and enforces that every answer is non-private
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

    if (net.isIP(hostname)) {
      if (isPrivateOrReservedIp(hostname)) {
        return {
          valid: false,
          error: `SSRF Protection: Target IP (${hostname}) is in private/reserved address space. Access blocked.`
        };
      }
      return { valid: true };
    }

    try {
      // Validate EVERY DNS record returned (A and AAAA)
      const lookupResults = await dns.promises.lookup(hostname, { all: true });
      if (!lookupResults || lookupResults.length === 0) {
        return { valid: false, error: `DNS resolution returned no addresses for hostname '${hostname}'` };
      }

      for (const record of lookupResults) {
        if (isPrivateOrReservedIp(record.address)) {
          return {
            valid: false,
            error: `SSRF Protection: Destination resolved to private/reserved IP address (${record.address}). Access blocked.`
          };
        }
      }
    } catch (err: any) {
      return { valid: false, error: `DNS resolution failed for hostname '${hostname}': ${err.message}` };
    }
  }

  return { valid: true };
}

/**
 * Creates custom http and https Agents configured with a secure socket-level DNS resolver.
 * - Resolves all DNS records for the host.
 * - Enforces that every resolved address is non-private.
 * - Pins the outbound TCP socket to the validated IP address, completely eliminating
 *   the Time-of-Check to Time-of-Use (TOCTOU) DNS rebinding attack window.
 */
export function createSecureAgents() {
  const allowPrivate = process.env.ALLOW_PRIVATE_ENDPOINTS === 'true';

  const secureLookup = (
    hostname: string,
    options: any,
    callback: (err: Error | null, address?: any, family?: number) => void
  ) => {
    // If hostname is directly an IP literal
    if (net.isIP(hostname)) {
      if (!allowPrivate && isPrivateOrReservedIp(hostname)) {
        return callback(new Error(`SSRF Protection: Direct connection to private/reserved IP (${hostname}) is blocked.`));
      }
      return callback(null, hostname, net.isIPv4(hostname) ? 4 : 6);
    }

    // Resolve all DNS records (IPv4 and IPv6)
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses || addresses.length === 0) {
        return callback(new Error(`DNS resolution returned no addresses for hostname '${hostname}'`));
      }

      if (!allowPrivate) {
        // Enforce SSRF boundary across EVERY DNS answer returned
        for (const record of addresses) {
          if (isPrivateOrReservedIp(record.address)) {
            return callback(
              new Error(`SSRF Protection: Hostname '${hostname}' resolved to private/reserved IP address (${record.address}). Access blocked.`)
            );
          }
        }
      }

      // Pin outbound socket connection to the first verified address
      const pinned = addresses[0];
      if (options && options.all) {
        callback(null, addresses as any);
      } else {
        callback(null, pinned.address, pinned.family);
      }
    });
  };

  return {
    httpAgent: new http.Agent({ lookup: secureLookup as any, keepAlive: false }),
    httpsAgent: new https.Agent({ lookup: secureLookup as any, keepAlive: false })
  };
}
