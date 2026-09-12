import crypto from 'crypto';

export interface SignatureHeaders {
  'X-EventRelay-Timestamp': string;
  'X-EventRelay-Signature': string;
}

export interface PayloadSigner {
  sign(payload: string, secretKey: string, timestamp?: number): SignatureHeaders;
  verify(payload: string, secretKey: string, header: string, timestampHeader: string, toleranceSeconds?: number): boolean;
}

export class HmacSha256Signer implements PayloadSigner {
  sign(payload: string, secretKey: string, timestamp: number = Math.floor(Date.now() / 1000)): SignatureHeaders {
    const signaturePayload = `${timestamp}.${payload}`;
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(signaturePayload);
    const signature = hmac.digest('hex');

    return {
      'X-EventRelay-Timestamp': timestamp.toString(),
      'X-EventRelay-Signature': `t=${timestamp},v1=${signature}`
    };
  }

  verify(
    payload: string,
    secretKey: string,
    signatureHeader: string,
    timestampHeader: string,
    toleranceSeconds: number = 300
  ): boolean {
    const timestamp = parseInt(timestampHeader, 10);
    const now = Math.floor(Date.now() / 1000);

    // Guard against replay attacks
    if (Math.abs(now - timestamp) > toleranceSeconds) {
      return false;
    }

    const expected = this.sign(payload, secretKey, timestamp);
    const expectedSig = expected['X-EventRelay-Signature'];

    if (expectedSig.length !== signatureHeader.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(expectedSig),
      Buffer.from(signatureHeader)
    );
  }
}

export const hmacSigner = new HmacSha256Signer();
