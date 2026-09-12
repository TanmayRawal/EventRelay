"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hmacSigner = exports.HmacSha256Signer = void 0;
const crypto_1 = __importDefault(require("crypto"));
class HmacSha256Signer {
    sign(payload, secretKey, timestamp = Math.floor(Date.now() / 1000)) {
        const signaturePayload = `${timestamp}.${payload}`;
        const hmac = crypto_1.default.createHmac('sha256', secretKey);
        hmac.update(signaturePayload);
        const signature = hmac.digest('hex');
        return {
            'X-EventRelay-Timestamp': timestamp.toString(),
            'X-EventRelay-Signature': `t=${timestamp},v1=${signature}`
        };
    }
    verify(payload, secretKey, signatureHeader, timestampHeader, toleranceSeconds = 300) {
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
        return crypto_1.default.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signatureHeader));
    }
}
exports.HmacSha256Signer = HmacSha256Signer;
exports.hmacSigner = new HmacSha256Signer();
