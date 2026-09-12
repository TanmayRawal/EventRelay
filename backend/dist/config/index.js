"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    port: parseInt(process.env.PORT || '4000', 10),
    databaseUrl: process.env.DATABASE_URL || 'postgres://eventrelay:eventrelay_secret@localhost:5432/eventrelay_db',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    streamName: 'eventrelay:deliveries:stream',
    consumerGroup: 'eventrelay-workers-group',
    consumerName: `worker-${process.pid}`,
    maxRetriesDefault: 5,
    circuitThreshold: 5,
    circuitCoolDownSeconds: 30
};
