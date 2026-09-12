"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateFullJitterDelay = calculateFullJitterDelay;
/**
 * Calculates retry delay using Exponential Backoff with Full Jitter.
 * Formula: sleep = random_between(0, min(maxBackoff, base * 2 ^ attempt))
 * Prevents the thundering herd problem during service recovery.
 */
function calculateFullJitterDelay(attempt, options = {}) {
    const base = options.baseSeconds ?? 2;
    const max = options.maxSeconds ?? 600; // 10 minutes max backoff
    const expBackoff = base * Math.pow(2, Math.max(0, attempt - 1));
    const cappedBackoff = Math.min(max, expBackoff);
    // Full jitter: uniformly distributed between 0 and cappedBackoff
    const jitteredDelay = Math.random() * cappedBackoff;
    return Math.max(1, Math.round(jitteredDelay));
}
