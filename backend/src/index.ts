import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config';
import { ingestEvent, listEvents } from './api/eventsController';
import { createEndpoint, listEndpoints } from './api/endpointsController';
import { listDeliveries, replayDelivery } from './api/deliveriesController';
import { listCircuits, resetCircuit } from './api/circuitController';
import { streamQueue } from './redis/streamQueue';
import { deliveryWorker } from './worker/deliveryWorker';
import { retryScheduler } from './worker/retryScheduler';
import { requireApiKey } from './middleware/auth';
import { metrics } from './metrics/prometheus';

const app = express();

app.use(cors());
app.use(express.json());

// Correlation ID & Distributed Tracing Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId = req.header('X-Correlation-ID') || uuidv4();
  res.setHeader('X-Correlation-ID', correlationId);
  (req as any).correlationId = correlationId;
  next();
});

// Healthcheck
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'EventRelay-Engine',
    version: '1.0.0',
    timestamp: new Date()
  });
});

// Prometheus Metrics Scraping Endpoint
app.get('/metrics', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(metrics.exportPrometheus());
});

// Event APIs
app.post('/api/events', requireApiKey, ingestEvent);
app.get('/api/events', listEvents);

// Endpoint APIs
app.post('/api/endpoints', requireApiKey, createEndpoint);
app.get('/api/endpoints', listEndpoints);

// Delivery & DLQ Replay APIs
app.get('/api/deliveries', listDeliveries);
app.post('/api/deliveries/:id/replay', requireApiKey, replayDelivery);

// Circuit Breaker APIs
app.get('/api/circuits', listCircuits);
app.post('/api/circuits/:endpointId/reset', requireApiKey, resetCircuit);

async function bootstrap() {
  try {
    // 1. Initialize Redis Streams Consumer Group across all shards
    await streamQueue.initGroup();

    // 2. Start Worker Pool asynchronously
    if (process.env.RUN_WORKER !== 'false') {
      deliveryWorker.start().catch((err) => {
        console.error('[Worker] Fatal error:', err);
      });
    }

    // 3. Start Background Retry Scheduler
    if (process.env.RUN_SCHEDULER !== 'false') {
      retryScheduler.start();
    }

    // 4. Start Express HTTP Server
    app.listen(config.port, () => {
      console.log(`[EventRelay] Server running on port ${config.port}`);
      console.log(`[EventRelay] Prometheus metrics live at http://localhost:${config.port}/metrics`);
    });
  } catch (err) {
    console.error('[EventRelay] Startup failed:', err);
    process.exit(1);
  }
}

bootstrap();
