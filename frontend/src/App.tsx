import React, { useState, useEffect } from 'react';

interface Endpoint {
  id: string;
  name: string;
  url: string;
  rate_limit_rps: number;
  circuit_state: string;
  circuit_failures: number;
}

interface Delivery {
  id: string;
  event_id: string;
  event_type: string;
  endpoint_name: string;
  attempt_number: number;
  http_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  status: 'SUCCESS' | 'RETRYING' | 'DEAD_LETTER';
  created_at: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'deliveries' | 'endpoints' | 'dlq' | 'test'>('deliveries');
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Test event form state
  const [eventType, setEventType] = useState('order.created');
  const [payloadJson, setPayloadJson] = useState('{\n  "orderId": "ORD-9821",\n  "amount": 249.99,\n  "customer": "user@google.com"\n}');
  const [customIdempotency, setCustomIdempotency] = useState(`idemp-${Date.now()}`);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const fetchData = async () => {
    try {
      const [resEp, resDel] = await Promise.all([
        fetch('/api/endpoints').then(r => r.json()),
        fetch('/api/deliveries').then(r => r.json())
      ]);
      if (Array.isArray(resEp)) setEndpoints(resEp);
      if (Array.isArray(resDel)) setDeliveries(resDel);
    } catch (err) {
      console.warn('API fetch error (running in local mock mode if backend offline)');
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleReplay = async (deliveryId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}/replay`, { method: 'POST' });
      const data = await res.json();
      showToast(`Manual replay queued: ${deliveryId.slice(0, 8)}...`);
      fetchData();
    } catch (err: any) {
      showToast('Error triggering replay');
    } finally {
      setLoading(false);
    }
  };

  const handleResetCircuit = async (endpointId: string) => {
    try {
      await fetch(`/api/circuits/${endpointId}/reset`, { method: 'POST' });
      showToast(`Circuit breaker reset to CLOSED`);
      fetchData();
    } catch (err) {
      showToast('Failed to reset circuit');
    }
  };

  const handleSendEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const parsed = JSON.parse(payloadJson);
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': customIdempotency
        },
        body: JSON.stringify({ eventType, payload: parsed })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.duplicate ? 'Duplicate request detected (Idempotent response)!' : 'Event queued for delivery!');
        setCustomIdempotency(`idemp-${Date.now()}`);
        fetchData();
      } else {
        showToast(`Error: ${data.error || 'Failed to dispatch'}`);
      }
    } catch (err: any) {
      showToast(`Invalid JSON payload: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const dlqDeliveries = deliveries.filter(d => d.status === 'DEAD_LETTER');
  const successDeliveries = deliveries.filter(d => d.status === 'SUCCESS');
  const successRate = deliveries.length > 0 ? Math.round((successDeliveries.length / deliveries.length) * 100) : 100;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 bg-blue-600 text-white rounded font-mono text-xs font-bold uppercase tracking-wider">
              EventRelay v1.0
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Distributed Webhook Gateway & Fault-Tolerant Engine
            </h1>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Enterprise event delivery with Redis Streams, Circuit Breaker failover, and Dead-Letter Queue replay.
          </p>
        </div>

        {/* Live Metrics */}
        <div className="grid grid-cols-3 gap-4 mt-4 md:mt-0">
          <div className="bg-slate-800/70 border border-slate-700/60 rounded-lg p-3 text-center">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Success Rate</div>
            <div className="text-xl font-bold text-emerald-400">{successRate}%</div>
          </div>
          <div className="bg-slate-800/70 border border-slate-700/60 rounded-lg p-3 text-center">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Total Delivered</div>
            <div className="text-xl font-bold text-blue-400">{deliveries.length}</div>
          </div>
          <div className="bg-slate-800/70 border border-slate-700/60 rounded-lg p-3 text-center">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">DLQ Failures</div>
            <div className={`text-xl font-bold ${dlqDeliveries.length > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
              {dlqDeliveries.length}
            </div>
          </div>
        </div>
      </header>

      {/* Toast Alert */}
      {toast && (
        <div className="my-4 px-4 py-2.5 bg-blue-900/80 border border-blue-500/50 text-blue-100 rounded-lg text-sm flex items-center justify-between shadow-lg">
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="text-blue-300 hover:text-white font-bold text-sm ml-4">✕</button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex gap-2 border-b border-slate-800 mt-6 pb-2">
        <button
          onClick={() => setActiveTab('deliveries')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'deliveries' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          Delivery Stream ({deliveries.length})
        </button>
        <button
          onClick={() => setActiveTab('dlq')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'dlq' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          Dead-Letter Queue ({dlqDeliveries.length})
        </button>
        <button
          onClick={() => setActiveTab('endpoints')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'endpoints' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          Endpoints & Circuits ({endpoints.length})
        </button>
        <button
          onClick={() => setActiveTab('test')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'test' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          Trigger Test Event
        </button>
      </div>

      {/* Tab Contents */}
      <div className="mt-6">
        {/* Deliveries Tab */}
        {activeTab === 'deliveries' && (
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700/60 flex items-center justify-between">
              <h2 className="font-semibold text-slate-200">Real-Time Dispatch Feed</h2>
              <span className="text-xs text-slate-400">Auto-refreshing every 4s</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-800/90 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-700/60">
                  <tr>
                    <th className="px-6 py-3">Event Type</th>
                    <th className="px-6 py-3">Target Endpoint</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">HTTP Code</th>
                    <th className="px-6 py-3">Duration</th>
                    <th className="px-6 py-3">Attempt</th>
                    <th className="px-6 py-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {deliveries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                        No deliveries logged yet. Trigger a test event!
                      </td>
                    </tr>
                  ) : (
                    deliveries.map((del) => (
                      <tr key={del.id} className="hover:bg-slate-800/40">
                        <td className="px-6 py-3.5 font-mono text-xs text-blue-300 font-semibold">{del.event_type}</td>
                        <td className="px-6 py-3.5 text-slate-200">{del.endpoint_name}</td>
                        <td className="px-6 py-3.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            del.status === 'SUCCESS' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                            del.status === 'RETRYING' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                            'bg-rose-950 text-rose-300 border border-rose-800'
                          }`}>
                            {del.status}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 font-mono text-xs">
                          {del.http_status ? (
                            <span className={del.http_status < 400 ? 'text-emerald-400' : 'text-rose-400'}>
                              {del.http_status}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-6 py-3.5 font-mono text-xs">{del.duration_ms ? `${del.duration_ms}ms` : '—'}</td>
                        <td className="px-6 py-3.5 text-xs text-slate-400">#{del.attempt_number}</td>
                        <td className="px-6 py-3.5 text-xs text-slate-400">{new Date(del.created_at).toLocaleTimeString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* DLQ Tab */}
        {activeTab === 'dlq' && (
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-700/60">
              <div>
                <h2 className="text-lg font-semibold text-rose-300">Dead-Letter Queue (DLQ) Inspector</h2>
                <p className="text-sm text-slate-400">
                  Failed webhook requests exceeding max exponential retries. Inspect error traces and replay idempotently.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {dlqDeliveries.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  Dead-Letter Queue is empty. All deliveries have succeeded or are in healthy retry loops!
                </div>
              ) : (
                dlqDeliveries.map((d) => (
                  <div key={d.id} className="p-4 bg-slate-900 border border-rose-900/60 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-rose-400 font-bold uppercase">{d.event_type}</span>
                        <span className="text-slate-500 text-xs">•</span>
                        <span className="text-xs text-slate-400 font-mono">ID: {d.id}</span>
                      </div>
                      <div className="text-sm text-slate-200 mt-1 font-semibold">Target: {d.endpoint_name}</div>
                      <div className="text-xs text-rose-400 mt-1 font-mono bg-rose-950/40 p-2 rounded border border-rose-900/40">
                        {d.error_message || 'Timeout or connection refused'}
                      </div>
                    </div>

                    <button
                      onClick={() => handleReplay(d.id)}
                      disabled={loading}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-xs rounded-lg transition-colors whitespace-nowrap shadow"
                    >
                      ↺ 1-Click Replay
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Endpoints & Circuits Tab */}
        {activeTab === 'endpoints' && (
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-2">Endpoint Health & Circuit Breakers</h2>
            <p className="text-sm text-slate-400 mb-6">
              When an endpoint fails continuously, its Circuit Breaker trips to <code>OPEN</code> to avoid cascading resource exhaustion.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {endpoints.length === 0 ? (
                <div className="col-span-2 text-center py-8 text-slate-500">
                  No endpoints configured. Use Docker Compose or the API to register endpoints.
                </div>
              ) : (
                endpoints.map((ep) => (
                  <div key={ep.id} className="p-5 bg-slate-900 border border-slate-800 rounded-lg">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-slate-100">{ep.name}</h3>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold ${
                        ep.circuit_state === 'CLOSED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' :
                        ep.circuit_state === 'HALF_OPEN' ? 'bg-amber-950 text-amber-300 border border-amber-700' :
                        'bg-rose-950 text-rose-300 border border-rose-700'
                      }`}>
                        Circuit: {ep.circuit_state || 'CLOSED'}
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 font-mono mt-2 break-all">{ep.url}</div>

                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800 text-xs text-slate-400">
                      <span>Rate Limit: <b>{ep.rate_limit_rps} RPS</b></span>
                      <span>Failures: <b>{ep.circuit_failures || 0}</b></span>
                      {ep.circuit_state === 'OPEN' && (
                        <button
                          onClick={() => handleResetCircuit(ep.id)}
                          className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold"
                        >
                          Force Reset
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Trigger Test Event Tab */}
        {activeTab === 'test' && (
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-6 max-w-2xl">
            <h2 className="text-lg font-semibold text-white mb-1">Simulate Business Event Dispatch</h2>
            <p className="text-sm text-slate-400 mb-6">
              Dispatches an event payload with an Idempotency-Key. If re-sent with the same key, the gateway guarantees zero duplicate delivery.
            </p>

            <form onSubmit={handleSendEvent} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Idempotency-Key</label>
                <input
                  type="text"
                  value={customIdempotency}
                  onChange={(e) => setCustomIdempotency(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Event Type</label>
                <input
                  type="text"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Event Payload (JSON)</label>
                <textarea
                  rows={5}
                  value={payloadJson}
                  onChange={(e) => setPayloadJson(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-sm rounded-lg transition-colors shadow-lg"
              >
                {loading ? 'Dispatching to Redis Streams...' : '🚀 Ingest & Queue Webhook Event'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
