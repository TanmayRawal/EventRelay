import { isPrivateOrReservedIp, validateEndpointUrl } from '../src/security/ssrfValidator';

describe('SSRF Validator (Security Boundary Protection)', () => {
  describe('isPrivateOrReservedIp', () => {
    it('should identify loopback IPs as private/reserved', () => {
      expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('127.0.1.1')).toBe(true);
      expect(isPrivateOrReservedIp('::1')).toBe(true);
    });

    it('should identify RFC 1918 private subnets as private', () => {
      expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('10.254.1.5')).toBe(true);
      expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
      expect(isPrivateOrReservedIp('192.168.1.100')).toBe(true);
      expect(isPrivateOrReservedIp('192.168.0.1')).toBe(true);
    });

    it('should identify AWS/cloud link-local metadata IPs as reserved', () => {
      expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
      expect(isPrivateOrReservedIp('169.254.1.1')).toBe(true);
    });

    it('should allow valid public IP addresses', () => {
      expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
      expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
      expect(isPrivateOrReservedIp('93.184.216.34')).toBe(false);
    });
  });

  describe('validateEndpointUrl', () => {
    beforeEach(() => {
      delete process.env.ALLOW_PRIVATE_ENDPOINTS;
      process.env.ALLOW_HTTP_ENDPOINTS = 'true';
    });

    it('should reject non-HTTP/HTTPS protocols', async () => {
      const ftpResult = await validateEndpointUrl('ftp://example.com/file');
      expect(ftpResult.valid).toBe(false);
      expect(ftpResult.error).toContain('Unsupported protocol');

      const fileResult = await validateEndpointUrl('file:///etc/passwd');
      expect(fileResult.valid).toBe(false);
    });

    it('should reject localhost hostname', async () => {
      const result = await validateEndpointUrl('http://localhost:9000/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Access to localhost is blocked');
    });

    it('should permit private endpoints when ALLOW_PRIVATE_ENDPOINTS is enabled', async () => {
      process.env.ALLOW_PRIVATE_ENDPOINTS = 'true';
      const result = await validateEndpointUrl('http://127.0.0.1:9000/webhook');
      expect(result.valid).toBe(true);
    });
  });
});
