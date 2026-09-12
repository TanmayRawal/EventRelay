"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = require("../config");
exports.redis = new ioredis_1.default(config_1.config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times) {
        const delay = Math.min(times * 100, 3000);
        return delay;
    }
});
exports.redis.on('connect', () => {
    console.log('[Redis] Connected successfully');
});
exports.redis.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
});
