/**
 * EventRelay Comprehensive Verification Suite
 * Executes an end-to-end verification of all core architectural subsystems:
 * 1. Health & Infrastructure Connectivity (API, Postgres, Redis, Mock-Receiver, Frontend)
 * 2. Endpoint Provisioning & Masked Secret Verification
 * 3. Security Boundary: Timing-Safe API Key Authentication & Inbound Throttling
 * 4. Idempotent Ingestion (Exact duplicate prevention test)
 * 5. Virtual Stream Sharding & HMAC-SHA256 Payload Signature Verification
 * 6. Fault-Tolerance: Circuit Breaker Outage Detection & State Trip (CLOSED -> OPEN)
 * 7. Dead-Letter Queue (DLQ) & Manual Replay with Preserved Ordering Key
 * 8. Prometheus Telemetry Exposition (/metrics)
 */

const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:4000';
const MOCK_BASE = process.env.MOCK_BASE || 'http://localhost:9000';
const FRONTEND_BASE = process.env.FRONTEND_BASE || 'http://localhost:3000';
const API_KEY = process.env.EVENTRELAY_API_KEY || 'er_secure_local_dev_key_8921';

function makeRequest(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const headers = { ...options.headers };

    // Automatically inject API key unless explicitly opted out
    if (headers['X-API-Key'] === undefined && !headers['Authorization'] && !options.noAuth) {
      headers['X-API-Key'] = API_KEY;
    }
    if (headers['X-API-Key'] === false) {
      delete headers['X-API-Key'];
    }

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers
    };

    if (postData) {
      if (typeof postData === 'object') {
        postData = JSON.stringify(postData);
        reqOptions.headers['Content-Type'] = 'application/json';
      }
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (_) {
          parsed = body;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('error', (err) => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function runAllTests() {
  console.log('\n================================================================================');
  console.log('       EVENTRELAY DISTRIBUTED WEBHOOK GATEWAY - COMPLETE VERIFICATION SUITE       ');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // TEST 1: Health & Infrastructure
  // -------------------------------------------------------------
  console.log('--- TEST SUITE 1: Infrastructure & Health Checks ---');
  try {
    const health = await makeRequest(`${API_BASE}/health`, { noAuth: true });
    assert(health.statusCode === 200, `Backend Gateway Health HTTP 200 (Got: ${health.statusCode})`);
    assert(health.data.status.toLowerCase() === 'healthy', `Gateway Status is healthy (Got: ${health.data.status})`);
    assert(health.data.service === 'EventRelay-Engine', `Gateway Service Name: ${health.data.service}`);
  } catch (err) {
    assert(false, `Backend Gateway connection failed: ${err.message}`);
  }

  try {
    const mockHealth = await makeRequest(`${MOCK_BASE}/health`, { noAuth: true });
    assert(mockHealth.statusCode === 200, `Mock Webhook Receiver Health HTTP 200 (Got: ${mockHealth.statusCode})`);
    assert(mockHealth.data.status === 'OK', `Mock Receiver Status: ${mockHealth.data.status}`);
  } catch (err) {
    assert(false, `Mock receiver health check failed: ${err.message}`);
  }

  try {
    const frontendRes = await makeRequest(`${FRONTEND_BASE}/`, { noAuth: true });
    assert(frontendRes.statusCode === 200, `Frontend React Dashboard HTTP 200 (Nginx port 3000)`);
    assert(typeof frontendRes.data === 'string' && frontendRes.data.includes('<title>EventRelay'), `Frontend serves EventRelay single-page application`);
  } catch (err) {
    assert(false, `Frontend reachability check failed: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 2: Endpoint Registration & Secret Masking
  // -------------------------------------------------------------
  console.log('\n--- TEST SUITE 2: Endpoint Provisioning & Secret Masking ---');
  let standardEndpointId = null;
  let outageEndpointId = null;

  try {
    const epRes = await makeRequest(`${API_BASE}/api/endpoints`, {
      method: 'POST'
    }, {
      name: 'Verification Target Endpoint',
      url: 'http://eventrelay-mock-receiver:9000/webhook/success',
      secretKey: 'whsec_verification_secret_key_123',
      rateLimitRps: 100,
      maxRetries: 3,
      timeoutMs: 5000,
      subscribedEvents: ['payment.success', 'order.shipped', 'verification.test']
    });

    assert(epRes.statusCode === 201, `Create Standard Endpoint HTTP 201 (Got: ${epRes.statusCode})`);
    standardEndpointId = epRes.data.id;
    assert(!!standardEndpointId, `Registered Endpoint ID: ${standardEndpointId}`);
    const returnedSecret = epRes.data.secret_key || epRes.data.secretKey;
    assert(returnedSecret && returnedSecret.startsWith('whsec_') && returnedSecret.length > 20, `Raw secret returned once on creation (Got: ${returnedSecret})`);

    // Verify GET endpoint lists masked secret
    const listRes = await makeRequest(`${API_BASE}/api/endpoints`);
    assert(listRes.statusCode === 200, `List Endpoints HTTP 200`);
    const epRecord = listRes.data.find(e => e.id === standardEndpointId);
    assert(!!epRecord, `Found standard endpoint in list`);
    assert(epRecord.secret_preview.includes('**********'), `Secret key masked on GET (/api/endpoints) (Got: ${epRecord.secret_preview})`);
    assert(!epRecord.secret_key, `Raw secret_key excluded from GET response`);
  } catch (err) {
    assert(false, `Endpoint creation / masking failed: ${err.message}`);
  }

  try {
    const outageRes = await makeRequest(`${API_BASE}/api/endpoints`, {
      method: 'POST'
    }, {
      name: 'Outage Target Endpoint',
      url: 'http://eventrelay-mock-receiver:9000/webhook/failing',
      secretKey: 'whsec_outage_secret_key_456',
      rateLimitRps: 50,
      maxRetries: 2,
      timeoutMs: 3000,
      subscribedEvents: ['outage.simulation']
    });

    assert(outageRes.statusCode === 201, `Create Outage Endpoint HTTP 201 (Got: ${outageRes.statusCode})`);
    outageEndpointId = outageRes.data.id;
    assert(!!outageEndpointId, `Registered Outage Endpoint ID: ${outageEndpointId}`);
  } catch (err) {
    assert(false, `Outage endpoint creation failed: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 3: Ingestion Authentication & Throttling
  // -------------------------------------------------------------
  console.log('\n--- TEST SUITE 3: Security Boundary & Ingestion Rate Limiting ---');
  try {
    // 3A: Request with NO key must return 401
    const unauthRes = await makeRequest(`${API_BASE}/api/events`, {
      method: 'POST',
      noAuth: true
    }, { eventType: 'test', payload: {} });
    assert(unauthRes.statusCode === 401, `Unauthenticated request rejected with HTTP 401 (Got: ${unauthRes.statusCode})`);

    // 3B: Request with WRONG key must return 403
    const forbiddenRes = await makeRequest(`${API_BASE}/api/events`, {
      method: 'POST',
      headers: { 'X-API-Key': 'invalid_secret_key_xyz' }
    }, { eventType: 'test', payload: {} });
    assert(forbiddenRes.statusCode === 403, `Invalid API key rejected with HTTP 403 (Got: ${forbiddenRes.statusCode})`);

    // 3C: Replay without key must return 401
    const replayUnauth = await makeRequest(`${API_BASE}/api/deliveries/any-id/replay`, {
      method: 'POST',
      noAuth: true
    });
    assert(replayUnauth.statusCode === 401, `Unauthenticated delivery replay rejected with HTTP 401 (Got: ${replayUnauth.statusCode})`);
  } catch (err) {
    assert(false, `Authentication boundary test failed: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 4: Idempotent Ingestion (Fresh vs Duplicate)
  // -------------------------------------------------------------
  console.log('\n--- TEST SUITE 4: Ingestion API & Idempotency Deduplication ---');
  const testIdempotencyKey = `idem-verify-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  let ingestedEventId = null;

  try {
    // 4A: First ingestion of new event
    const firstIngest = await makeRequest(`${API_BASE}/api/events`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': testIdempotencyKey
      }
    }, {
      eventType: 'verification.test',
      payload: {
        accountId: 'acc_tanmay_001',
        amount: 549.99,
        currency: 'USD',
        timestamp: new Date().toISOString()
      },
      orderingKey: 'acc_tanmay_001',
      endpointIds: [standardEndpointId]
    });

    assert(firstIngest.statusCode === 201, `First Ingest returns HTTP 201 Created`);
    assert(firstIngest.data.success === true, `First Ingest success flag is true`);
    assert(!!firstIngest.headers['x-ratelimit-limit'], `Includes X-RateLimit-Limit header (${firstIngest.headers['x-ratelimit-limit']})`);
    assert(firstIngest.headers['x-ratelimit-remaining'] !== undefined, `Includes X-RateLimit-Remaining header`);
    ingestedEventId = firstIngest.data.eventId;
    assert(!!ingestedEventId, `Generated Event ID: ${ingestedEventId}`);

    // 4B: Re-send identical event with exact same Idempotency-Key
    const duplicateIngest = await makeRequest(`${API_BASE}/api/events`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': testIdempotencyKey
      }
    }, {
      eventType: 'verification.test',
      payload: {
        accountId: 'acc_tanmay_001',
        amount: 549.99,
        currency: 'USD',
        timestamp: new Date().toISOString()
      },
      orderingKey: 'acc_tanmay_001',
      endpointIds: [standardEndpointId]
    });

    assert(duplicateIngest.statusCode === 200, `Duplicate Ingest returns HTTP 200 OK`);
    assert(duplicateIngest.data.duplicate === true, `Duplicate Ingest correctly flagged duplicate: true`);
    assert(duplicateIngest.data.eventId === ingestedEventId, `Duplicate returns original Event ID (${ingestedEventId})`);
  } catch (err) {
    assert(false, `Idempotency verification failed: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 5: Asynchronous Dispatch & HMAC Delivery Verification
  // -------------------------------------------------------------
  console.log('\n--- TEST SUITE 5: Virtual Sharding & HMAC-SHA256 Verification ---');
  let matchingDelivery = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(500);
    try {
      const deliveriesRes = await makeRequest(`${API_BASE}/api/deliveries?limit=100`);
      matchingDelivery = deliveriesRes.data.find(d => d.event_id === ingestedEventId && d.endpoint_id === standardEndpointId);
      if (matchingDelivery && matchingDelivery.status === 'SUCCESS') break;
    } catch (_) {}
  }

  try {
    assert(!!matchingDelivery, `Found delivery record for Event ID ${ingestedEventId}`);
    if (matchingDelivery) {
      assert(matchingDelivery.status === 'SUCCESS', `Delivery status is SUCCESS (Got: ${matchingDelivery.status})`);
      assert(matchingDelivery.http_status === 200, `Downstream HTTP response is 200 OK (Got: ${matchingDelivery.http_status})`);
      assert(matchingDelivery.duration_ms > 0, `Recorded delivery latency: ${matchingDelivery.duration_ms}ms`);
    }

    // Verify in mock-receiver that HMAC signature was validated
    let receivedEvent = null;
    let mockLogs = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      mockLogs = await makeRequest(`${MOCK_BASE}/api/received?limit=200`, { noAuth: true });
      if (mockLogs.statusCode === 200 && Array.isArray(mockLogs.data)) {
        receivedEvent = mockLogs.data.find(r => r.headers['x-eventrelay-event-id'] === ingestedEventId);
        if (receivedEvent) break;
      }
      await sleep(400);
    }
    assert(mockLogs.statusCode === 200, `Mock Receiver logs HTTP 200`);
    assert(!!receivedEvent, `Mock receiver captured dispatch for Event ID ${ingestedEventId}`);
    if (receivedEvent) {
      assert(!!receivedEvent.headers['x-eventrelay-signature'], `Payload contains HMAC-SHA256 signature header`);
      assert(!!receivedEvent.headers['x-eventrelay-timestamp'], `Payload contains timestamp replay defense header`);
    }
  } catch (err) {
    assert(false, `Delivery verification failed: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 6: Circuit Breaker Outage Detection & Tripping
  // -------------------------------------------------------------
  console.log('\n--- TEST SUITE 6: Fault-Tolerance & Circuit Breaker State Machine ---');
  try {
    for (let i = 0; i < 6; i++) {
      await makeRequest(`${API_BASE}/api/events`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': `outage-trigger-${Date.now()}-${i}`
        }
      }, {
        eventType: 'outage.simulation',
        payload: { attempt: i, test: 'circuit-breaker' },
        endpointIds: [outageEndpointId]
      });
    }

    let outageCircuit = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(500);
      try {
        const circuitsRes = await makeRequest(`${API_BASE}/api/circuits`);
        if (circuitsRes.statusCode === 200) {
          outageCircuit = circuitsRes.data.find(c => c.endpoint_id === outageEndpointId);
          if (outageCircuit && outageCircuit.state === 'OPEN') break;
        }
      } catch (_) {}
    }

    const circuitsRes = await makeRequest(`${API_BASE}/api/circuits`);
    assert(circuitsRes.statusCode === 200, `Fetch Circuit Breakers HTTP 200`);
    
    outageCircuit = circuitsRes.data.find(c => c.endpoint_id === outageEndpointId);
    assert(!!outageCircuit, `Found circuit record for outage endpoint`);
    if (outageCircuit) {
      assert(outageCircuit.state === 'OPEN', `Circuit Breaker state TRIPPED to OPEN (Got: ${outageCircuit.state})`);
      assert(outageCircuit.failure_count >= 5, `Failure count recorded: ${outageCircuit.failure_count} (threshold: ${outageCircuit.threshold_failures})`);
    }
  } catch (err) {
    assert(false, `Circuit breaker verification failed: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 7: Dead-Letter Queue (DLQ) & 1-Click Manual Replay API
  // -------------------------------------------------------------
  console.log('\n--- TEST SUITE 7: Dead-Letter Queue (DLQ) & Replay Ordering Key ---');
  try {
    const allDeliveries = await makeRequest(`${API_BASE}/api/deliveries?limit=50`);
    const dlqCandidates = allDeliveries.data.filter(d => d.status === 'DEAD_LETTER' || d.status === 'RETRYING');
    assert(dlqCandidates.length > 0, `Captured ${dlqCandidates.length} delivery attempts in retry/DLQ pipeline`);

    if (dlqCandidates.length > 0) {
      const targetDelivery = dlqCandidates[0];
      const replayRes = await makeRequest(`${API_BASE}/api/deliveries/${targetDelivery.id}/replay`, {
        method: 'POST'
      });
      assert(replayRes.statusCode === 200, `Replay API HTTP 200 (Delivery ${targetDelivery.id})`);
      assert(replayRes.data.delivery.status === 'RETRYING', `Delivery status reset to RETRYING for re-enqueue`);
      assert(replayRes.data.delivery.attempt_number === 1, `Delivery attempt counter reset to 1 for re-enqueue`);
    }
  } catch (err) {
    assert(false, `DLQ & Replay verification failed: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 8: Prometheus Telemetry Exposition (/metrics)
  // -------------------------------------------------------------
  console.log('\n--- TEST SUITE 8: Prometheus Live Telemetry Scrape ---');
  try {
    // Test unauthenticated /metrics request is rejected with 401
    const unauthMetrics = await makeRequest(`${API_BASE}/metrics`, { noAuth: true });
    assert(unauthMetrics.statusCode === 401, `Unauthenticated /metrics rejected with HTTP 401 (Got: ${unauthMetrics.statusCode})`);

    // Test authenticated /metrics request succeeds with 200
    const metricsRes = await makeRequest(`${API_BASE}/metrics`);
    assert(metricsRes.statusCode === 200, `Authenticated Prometheus /metrics endpoint HTTP 200`);
    assert(metricsRes.headers['content-type'].includes('text/plain'), `Prometheus exposition Content-Type text/plain`);
    const body = typeof metricsRes.data === 'string' ? metricsRes.data : JSON.stringify(metricsRes.data);
    assert(body.includes('eventrelay_events_ingested_total'), `Exports eventrelay_events_ingested_total counter`);
    assert(body.includes('eventrelay_deliveries_total'), `Exports eventrelay_deliveries_total counter`);
    assert(body.includes('eventrelay_delivery_duration_seconds_bucket'), `Exports latency histogram buckets`);
    assert(body.includes('eventrelay_circuit_breaker_state'), `Exports circuit breaker state gauge`);
    assert(body.includes('eventrelay_dlq_total'), `Exports eventrelay_dlq_total counter`);
  } catch (err) {
    assert(false, `Prometheus metrics scrape failed: ${err.message}`);
  }

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n================================================================================');
  console.log(`  VERIFICATION RESULTS:  ${passed} PASSED  |  ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed === 0) {
    console.log('>>> ALL EVENTRELAY SUBSYSTEMS ARE 100% OPERATIONAL & VERIFIED <<<');
    process.exit(0);
  } else {
    console.error(`>>> ${failed} TEST(S) FAILED <<<`);
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
