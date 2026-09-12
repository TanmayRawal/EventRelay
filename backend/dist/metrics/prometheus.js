"use strict";
/**
 * Enterprise Prometheus Metrics Exporter
 * Formats in-memory counters and latency histograms into the official
 * Prometheus text exposition format without requiring heavyweight native dependencies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.metrics = void 0;
class MetricsRegistry {
    eventsIngested = new Map();
    deliveriesTotal = new Map();
    dlqTotal = 0;
    latencyBuckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0];
    latencyHistogram = new Map();
    latencySum = 0;
    latencyCount = 0;
    circuitStates = new Map(); // 0: CLOSED, 1: HALF_OPEN, 2: OPEN
    constructor() {
        this.latencyBuckets.forEach(b => this.latencyHistogram.set(b, 0));
    }
    incIngested(eventType) {
        const curr = this.eventsIngested.get(eventType) || 0;
        this.eventsIngested.set(eventType, curr + 1);
    }
    incDelivery(endpoint, status) {
        const key = `endpoint="${endpoint}",status="${status}"`;
        const curr = this.deliveriesTotal.get(key) || 0;
        this.deliveriesTotal.set(key, curr + 1);
    }
    incDlq() {
        this.dlqTotal++;
    }
    observeLatency(durationSeconds) {
        this.latencyCount++;
        this.latencySum += durationSeconds;
        for (const bucket of this.latencyBuckets) {
            if (durationSeconds <= bucket) {
                const curr = this.latencyHistogram.get(bucket) || 0;
                this.latencyHistogram.set(bucket, curr + 1);
            }
        }
    }
    setCircuitState(endpointId, state) {
        const val = state === 'CLOSED' ? 0 : state === 'HALF_OPEN' ? 1 : 2;
        this.circuitStates.set(endpointId, val);
    }
    exportPrometheus() {
        const lines = [];
        // 1. Events Ingested
        lines.push('# HELP eventrelay_events_ingested_total Total number of business events ingested');
        lines.push('# TYPE eventrelay_events_ingested_total counter');
        if (this.eventsIngested.size === 0) {
            lines.push('eventrelay_events_ingested_total 0');
        }
        else {
            for (const [type, val] of this.eventsIngested.entries()) {
                lines.push(`eventrelay_events_ingested_total{event_type="${type}"} ${val}`);
            }
        }
        // 2. Deliveries Total
        lines.push('\n# HELP eventrelay_deliveries_total Total deliveries attempted by outcome');
        lines.push('# TYPE eventrelay_deliveries_total counter');
        if (this.deliveriesTotal.size === 0) {
            lines.push('eventrelay_deliveries_total 0');
        }
        else {
            for (const [labels, val] of this.deliveriesTotal.entries()) {
                lines.push(`eventrelay_deliveries_total{${labels}} ${val}`);
            }
        }
        // 3. DLQ Total
        lines.push('\n# HELP eventrelay_dlq_total Total deliveries routed to Dead-Letter Queue');
        lines.push('# TYPE eventrelay_dlq_total counter');
        lines.push(`eventrelay_dlq_total ${this.dlqTotal}`);
        // 4. Latency Histogram
        lines.push('\n# HELP eventrelay_delivery_duration_seconds Webhook execution latency');
        lines.push('# TYPE eventrelay_delivery_duration_seconds histogram');
        for (const bucket of this.latencyBuckets) {
            lines.push(`eventrelay_delivery_duration_seconds_bucket{le="${bucket}"} ${this.latencyHistogram.get(bucket) || 0}`);
        }
        lines.push(`eventrelay_delivery_duration_seconds_bucket{le="+Inf"} ${this.latencyCount}`);
        lines.push(`eventrelay_delivery_duration_seconds_sum ${this.latencySum.toFixed(4)}`);
        lines.push(`eventrelay_delivery_duration_seconds_count ${this.latencyCount}`);
        // 5. Circuit Breaker States
        lines.push('\n# HELP eventrelay_circuit_breaker_state Current state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)');
        lines.push('# TYPE eventrelay_circuit_breaker_state gauge');
        for (const [endpoint, val] of this.circuitStates.entries()) {
            lines.push(`eventrelay_circuit_breaker_state{endpoint="${endpoint}"} ${val}`);
        }
        return lines.join('\n') + '\n';
    }
}
exports.metrics = new MetricsRegistry();
