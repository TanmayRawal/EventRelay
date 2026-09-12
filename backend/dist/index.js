"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const uuid_1 = require("uuid");
const config_1 = require("./config");
const eventsController_1 = require("./api/eventsController");
const endpointsController_1 = require("./api/endpointsController");
const deliveriesController_1 = require("./api/deliveriesController");
const circuitController_1 = require("./api/circuitController");
const streamQueue_1 = require("./redis/streamQueue");
const deliveryWorker_1 = require("./worker/deliveryWorker");
const prometheus_1 = require("./metrics/prometheus");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Correlation ID & Distributed Tracing Middleware
app.use((req, res, next) => {
    const correlationId = req.header('X-Correlation-ID') || (0, uuid_1.v4)();
    res.setHeader('X-Correlation-ID', correlationId);
    req.correlationId = correlationId;
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
    res.send(prometheus_1.metrics.exportPrometheus());
});
// Event APIs
app.post('/api/events', eventsController_1.ingestEvent);
app.get('/api/events', eventsController_1.listEvents);
// Endpoint APIs
app.post('/api/endpoints', endpointsController_1.createEndpoint);
app.get('/api/endpoints', endpointsController_1.listEndpoints);
// Delivery & DLQ Replay APIs
app.get('/api/deliveries', deliveriesController_1.listDeliveries);
app.post('/api/deliveries/:id/replay', deliveriesController_1.replayDelivery);
// Circuit Breaker APIs
app.get('/api/circuits', circuitController_1.listCircuits);
app.post('/api/circuits/:endpointId/reset', circuitController_1.resetCircuit);
async function bootstrap() {
    try {
        // 1. Initialize Redis Streams Consumer Group
        await streamQueue_1.streamQueue.initGroup();
        // 2. Start Worker Pool asynchronously
        if (process.env.RUN_WORKER !== 'false') {
            deliveryWorker_1.deliveryWorker.start().catch((err) => {
                console.error('[Worker] Fatal error:', err);
            });
        }
        // 3. Start Express HTTP Server
        app.listen(config_1.config.port, () => {
            console.log(`[EventRelay] Server running on port ${config_1.config.port}`);
            console.log(`[EventRelay] Prometheus metrics live at http://localhost:${config_1.config.port}/metrics`);
        });
    }
    catch (err) {
        console.error('[EventRelay] Startup failed:', err);
        process.exit(1);
    }
}
bootstrap();
