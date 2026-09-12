"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamQueue = exports.StreamQueue = void 0;
const client_1 = require("./client");
const config_1 = require("../config");
class StreamQueue {
    streamName;
    groupName;
    constructor() {
        this.streamName = config_1.config.streamName;
        this.groupName = config_1.config.consumerGroup;
    }
    async initGroup() {
        try {
            await client_1.redis.xgroup('CREATE', this.streamName, this.groupName, '0', 'MKSTREAM');
            console.log(`[StreamQueue] Consumer group '${this.groupName}' created.`);
        }
        catch (err) {
            if (err.message && err.message.includes('BUSYGROUP')) {
                // Group already exists, which is normal
            }
            else {
                console.error('[StreamQueue] Error creating consumer group:', err.message);
            }
        }
    }
    async publish(job) {
        const id = await client_1.redis.xadd(this.streamName, '*', 'deliveryId', job.deliveryId, 'eventId', job.eventId, 'endpointId', job.endpointId, 'attemptNumber', job.attemptNumber.toString());
        return id;
    }
    async readMessages(consumerName, count = 10, blockMs = 2000) {
        try {
            const response = await client_1.redis.xreadgroup('GROUP', this.groupName, consumerName, 'COUNT', count, 'BLOCK', blockMs, 'STREAMS', this.streamName, '>');
            if (!response || !Array.isArray(response) || response.length === 0) {
                return [];
            }
            const [streamEntry] = response;
            const [, rawMessages] = streamEntry;
            const jobs = [];
            for (const [messageId, fields] of rawMessages) {
                const fieldMap = {};
                for (let i = 0; i < fields.length; i += 2) {
                    fieldMap[fields[i]] = fields[i + 1];
                }
                jobs.push({
                    messageId,
                    job: {
                        deliveryId: fieldMap.deliveryId,
                        eventId: fieldMap.eventId,
                        endpointId: fieldMap.endpointId,
                        attemptNumber: parseInt(fieldMap.attemptNumber || '1', 10)
                    }
                });
            }
            return jobs;
        }
        catch (err) {
            console.error('[StreamQueue] Read error:', err.message);
            return [];
        }
    }
    async acknowledge(messageId) {
        await client_1.redis.xack(this.streamName, this.groupName, messageId);
    }
}
exports.StreamQueue = StreamQueue;
exports.streamQueue = new StreamQueue();
