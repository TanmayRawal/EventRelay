import { redis } from './client';
import { config } from '../config';

export interface DeliveryJob {
  deliveryId: string;
  eventId: string;
  endpointId: string;
  attemptNumber: number;
}

export class StreamQueue {
  private streamName: string;
  private groupName: string;

  constructor() {
    this.streamName = config.streamName;
    this.groupName = config.consumerGroup;
  }

  async initGroup(): Promise<void> {
    try {
      await redis.xgroup('CREATE', this.streamName, this.groupName, '0', 'MKSTREAM');
      console.log(`[StreamQueue] Consumer group '${this.groupName}' created.`);
    } catch (err: any) {
      if (err.message && err.message.includes('BUSYGROUP')) {
        // Group already exists, which is normal
      } else {
        console.error('[StreamQueue] Error creating consumer group:', err.message);
      }
    }
  }

  async publish(job: DeliveryJob): Promise<string> {
    const id = await redis.xadd(
      this.streamName,
      '*',
      'deliveryId', job.deliveryId,
      'eventId', job.eventId,
      'endpointId', job.endpointId,
      'attemptNumber', job.attemptNumber.toString()
    );
    return id as string;
  }

  async readMessages(consumerName: string, count = 10, blockMs = 2000): Promise<Array<{ messageId: string; job: DeliveryJob }>> {
    try {
      const response = await redis.xreadgroup(
        'GROUP', this.groupName, consumerName,
        'COUNT', count,
        'BLOCK', blockMs,
        'STREAMS', this.streamName, '>'
      );

      if (!response || !Array.isArray(response) || response.length === 0) {
        return [];
      }

      const [streamEntry] = response as any[];
      const [, rawMessages] = streamEntry;

      const jobs: Array<{ messageId: string; job: DeliveryJob }> = [];

      for (const [messageId, fields] of rawMessages) {
        const fieldMap: Record<string, string> = {};
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
    } catch (err: any) {
      console.error('[StreamQueue] Read error:', err.message);
      return [];
    }
  }

  async acknowledge(messageId: string): Promise<void> {
    await redis.xack(this.streamName, this.groupName, messageId);
  }
}

export const streamQueue = new StreamQueue();
