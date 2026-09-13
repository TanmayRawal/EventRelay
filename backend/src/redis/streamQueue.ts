import { redis } from './client';
import { config } from '../config';
import { partitioner } from '../sharding/partitioner';

export interface DeliveryJob {
  deliveryId: string;
  eventId: string;
  endpointId: string;
  attemptNumber: number;
}

export interface StreamMessage {
  messageId: string;
  streamName: string;
  job: DeliveryJob;
}

export class StreamQueue {
  private baseStream: string;
  private groupName: string;
  private allStreams: string[];

  constructor() {
    this.baseStream = config.streamName;
    this.groupName = config.consumerGroup;
    this.allStreams = [this.baseStream, ...partitioner.getAllShardStreams(this.baseStream)];
  }

  async initGroup(): Promise<void> {
    for (const stream of this.allStreams) {
      try {
        await redis.xgroup('CREATE', stream, this.groupName, '0', 'MKSTREAM');
      } catch (err: any) {
        if (!err.message?.includes('BUSYGROUP')) {
          console.error(`[StreamQueue] Error creating group on ${stream}:`, err.message);
        }
      }
    }
    console.log(`[StreamQueue] Consumer group '${this.groupName}' active across ${this.allStreams.length} stream partitions.`);
  }

  async publish(job: DeliveryJob, orderingKey?: string | null): Promise<{ messageId: string; streamName: string }> {
    const targetStream = partitioner.getShardStreamName(orderingKey, this.baseStream);
    const id = await redis.xadd(
      targetStream,
      '*',
      'deliveryId', job.deliveryId,
      'eventId', job.eventId,
      'endpointId', job.endpointId,
      'attemptNumber', job.attemptNumber.toString(),
      'streamName', targetStream
    );
    return { messageId: id as string, streamName: targetStream };
  }

  async readMessages(consumerName: string, count = 10, blockMs = 2000): Promise<StreamMessage[]> {
    try {
      // Build multi-stream query arguments: STREAMS s1 s2 ... > > ...
      const streamArgs = [
        'GROUP', this.groupName, consumerName,
        'COUNT', count.toString(),
        'BLOCK', blockMs.toString(),
        'STREAMS',
        ...this.allStreams,
        ...this.allStreams.map(() => '>')
      ];

      const response = await (redis as any).xreadgroup(...streamArgs);

      if (!response || !Array.isArray(response) || response.length === 0) {
        return [];
      }

      const messages: StreamMessage[] = [];

      for (const [streamName, rawMessages] of response) {
        if (!Array.isArray(rawMessages)) continue;

        for (const [messageId, fields] of rawMessages) {
          const fieldMap: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) {
            fieldMap[fields[i]] = fields[i + 1];
          }

          messages.push({
            messageId,
            streamName,
            job: {
              deliveryId: fieldMap.deliveryId,
              eventId: fieldMap.eventId,
              endpointId: fieldMap.endpointId,
              attemptNumber: parseInt(fieldMap.attemptNumber || '1', 10)
            }
          });
        }
      }

      return messages;
    } catch (err: any) {
      console.error('[StreamQueue] Read error:', err.message);
      return [];
    }
  }

  async acknowledge(streamName: string, messageId: string): Promise<void> {
    await redis.xack(streamName || this.baseStream, this.groupName, messageId);
  }

  getAllStreamNames(): string[] {
    return this.allStreams;
  }
}

export const streamQueue = new StreamQueue();
