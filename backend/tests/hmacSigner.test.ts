import { HmacSha256Signer } from '../src/crypto/hmacSigner';

describe('HmacSha256Signer', () => {
  const signer = new HmacSha256Signer();
  const secret = 'whsec_test_secret_key_12345';
  const payload = JSON.stringify({ event: 'order.completed', amount: 99.5 });

  it('should generate valid HMAC-SHA256 signature headers', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = signer.sign(payload, secret, timestamp);

    expect(headers['X-EventRelay-Timestamp']).toBe(timestamp.toString());
    expect(headers['X-EventRelay-Signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
  });

  it('should successfully verify a valid signature', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = signer.sign(payload, secret, timestamp);

    const isValid = signer.verify(
      payload,
      secret,
      headers['X-EventRelay-Signature'],
      headers['X-EventRelay-Timestamp']
    );

    expect(isValid).toBe(true);
  });

  it('should reject tampered payload', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = signer.sign(payload, secret, timestamp);
    const tamperedPayload = JSON.stringify({ event: 'order.completed', amount: 1000000.0 });

    const isValid = signer.verify(
      tamperedPayload,
      secret,
      headers['X-EventRelay-Signature'],
      headers['X-EventRelay-Timestamp']
    );

    expect(isValid).toBe(false);
  });

  it('should reject signature with expired timestamp (replay attack prevention)', () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const headers = signer.sign(payload, secret, oldTimestamp);

    const isValid = signer.verify(
      payload,
      secret,
      headers['X-EventRelay-Signature'],
      headers['X-EventRelay-Timestamp'],
      300 // 5 minute tolerance
    );

    expect(isValid).toBe(false);
  });
});
