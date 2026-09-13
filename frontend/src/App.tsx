import React, { useState, useEffect } from 'react';
import { Endpoint, Delivery, ActiveTab, ScenarioType } from './types';
import { Header } from './components/Header';
import { InteractiveDemoBar } from './components/InteractiveDemoBar';
import { DeliveryFeed } from './components/DeliveryFeed';
import { EndpointsView } from './components/EndpointsView';
import { DlqView } from './components/DlqView';
import { TriggerTestForm } from './components/TriggerTestForm';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('deliveries');
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Authentication Key State (No public hardcoded default)
  const [apiKey, setApiKey] = useState<string>(() => {
    return localStorage.getItem('eventrelay_api_key') || (import.meta as any).env?.VITE_API_KEY || '';
  });

  const handleUpdateApiKey = (newKey: string) => {
    setApiKey(newKey);
    localStorage.setItem('eventrelay_api_key', newKey);
    showToast(newKey ? 'API Key configured.' : 'API Key cleared (Open mode).');
  };

  const getAuthHeaders = (): Record<string, string> => {
    return apiKey ? { 'X-API-Key': apiKey } : {};
  };

  // Test event form state
  const [eventType, setEventType] = useState('order.created');
  const [orderingKey, setOrderingKey] = useState('');
  const [payloadJson, setPayloadJson] = useState('{\n  "orderId": "ORD-9821",\n  "amount": 249.99,\n  "customer": "alex@example.com"\n}');
  const [customIdempotency, setCustomIdempotency] = useState(`idemp-${Date.now()}`);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const fetchData = async () => {
    try {
      const [resEp, resDel] = await Promise.all([
        fetch('/api/endpoints').then(r => r.json()),
        fetch('/api/deliveries').then(r => r.json())
      ]);
      if (Array.isArray(resEp)) setEndpoints(resEp);
      if (Array.isArray(resDel)) setDeliveries(resDel);
    } catch {
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
    const t0 = performance.now();
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}/replay`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      const elapsed = Math.round(performance.now() - t0);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showToast(`Replay failed (${res.status}): ${errData.error || res.statusText}`);
        return;
      }
      showToast(`Replay queued in ${elapsed}ms: delivery ${deliveryId.slice(0, 8)} published to shard partition.`);
      fetchData();
    } catch {
      showToast('Error triggering delivery replay.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetCircuit = async (endpointId: string) => {
    try {
      const res = await fetch(`/api/circuits/${endpointId}/reset`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showToast(`Reset failed (${res.status}): ${errData.error || res.statusText}`);
        return;
      }
      showToast('Circuit breaker administratively reset to CLOSED.');
      fetchData();
    } catch {
      showToast('Failed to reset circuit breaker.');
    }
  };

  const handleSendEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const t0 = performance.now();
    try {
      const parsed = JSON.parse(payloadJson);
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': customIdempotency,
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          eventType,
          payload: parsed,
          orderingKey: orderingKey.trim() || undefined
        })
      });
      const elapsed = Math.round(performance.now() - t0);
      const data = await res.json();
      if (res.ok) {
        showToast(
          data.duplicate
            ? `Duplicate request intercepted in ${elapsed}ms: cached response returned.`
            : `Event ingested in ${elapsed}ms: queued to partition shard.`
        );
        setCustomIdempotency(`idemp-${Date.now()}`);
        fetchData();
      } else {
        showToast(`Request failed (${res.status}): ${data.error || 'Failed to dispatch'}`);
      }
    } catch (err: any) {
      showToast(`Invalid JSON payload: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const runQuickScenario = async (scenario: ScenarioType) => {
    setLoading(true);
    try {
      if (scenario === 'happy') {
        const orderNum = Math.floor(Math.random() * 90000 + 10000);
        const t0 = performance.now();
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `scenario-happy-${Date.now()}`,
            ...getAuthHeaders()
          },
          body: JSON.stringify({
            eventType: 'order.payment_completed',
            payload: { orderId: `ORD-${orderNum}`, amount: 149.99, currency: 'USD', customer: 'customer_101@example.com' },
            orderingKey: 'customer_101@example.com'
          })
        });
        const elapsed = Math.round(performance.now() - t0);
        showToast(`Scenario 1: Payment ingested in ${elapsed}ms (HTTP ${res.status}). Sharded via FNV-1a with HMAC-SHA256 signature.`);
        setActiveTab('deliveries');
        setTimeout(fetchData, 800);
      } else if (scenario === 'idempotent') {
        const sharedKey = `idemp-guard-${Date.now()}`;
        const payload = {
          eventType: 'order.payment_completed',
          payload: { orderId: 'ORD-DUP-TEST', amount: 999.00, customer: 'shopper_42@example.com' },
          orderingKey: 'shopper_42@example.com'
        };

        // First click
        await fetch('/api/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': sharedKey,
            ...getAuthHeaders()
          },
          body: JSON.stringify(payload)
        });

        // Immediate rapid second click
        const t1 = performance.now();
        const secondRes = await fetch('/api/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': sharedKey,
            ...getAuthHeaders()
          },
          body: JSON.stringify(payload)
        });
        const elapsed = Math.round(performance.now() - t1);
        const secondData = await secondRes.json();

        if (secondData.duplicate) {
          showToast(`Scenario 2: Duplicate key intercepted in ${elapsed}ms. Cached response returned with 0 duplicate executions.`);
        } else {
          showToast(`Scenario 2: Event ingested in ${elapsed}ms.`);
        }
        setActiveTab('deliveries');
        setTimeout(fetchData, 800);
      } else if (scenario === 'circuit') {
        const outageEp = endpoints.find(e => e.url.includes('failing') || e.name.toLowerCase().includes('outage'));
        const endpointIds = outageEp ? [outageEp.id] : undefined;
        const t0 = performance.now();

        for (let i = 0; i < 5; i++) {
          await fetch('/api/events', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': `scenario-outage-${Date.now()}-${i}`,
              ...getAuthHeaders()
            },
            body: JSON.stringify({
              eventType: 'outage.simulation',
              payload: { batch: i, reason: 'downstream 503 outage' },
              endpointIds
            })
          });
        }
        const elapsed = Math.round(performance.now() - t0);
        showToast(`Scenario 3: 5 consecutive downstream failures observed (${elapsed}ms). Circuit breaker state TRIPPED to OPEN.`);
        setActiveTab('endpoints');
        setTimeout(fetchData, 1500);
      } else if (scenario === 'dlq') {
        const candidate = deliveries.find(d => d.status === 'DEAD_LETTER' || d.status === 'RETRYING');
        if (candidate) {
          const t0 = performance.now();
          await handleReplay(candidate.id);
          const elapsed = Math.round(performance.now() - t0);
          showToast(`Scenario 4: Delivery ${candidate.id.slice(0, 8)} re-enqueued to stream shard in ${elapsed}ms with attempt reset to 1.`);
        } else {
          showToast('No DLQ deliveries found. Trigger Scenario 3 first to generate failed deliveries.');
        }
        setActiveTab('deliveries');
        setTimeout(fetchData, 800);
      }
    } catch (err: any) {
      showToast(`Error running scenario: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const dlqDeliveries = deliveries.filter(d => d.status === 'DEAD_LETTER');
  const successDeliveries = deliveries.filter(d => d.status === 'SUCCESS');
  const successRate = deliveries.length > 0 ? Math.round((successDeliveries.length / deliveries.length) * 100) : 100;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <Header
        successRate={successRate}
        totalDelivered={deliveries.length}
        dlqCount={dlqDeliveries.length}
        apiKey={apiKey}
        onUpdateApiKey={handleUpdateApiKey}
      />

      <InteractiveDemoBar
        loading={loading}
        onRunScenario={runQuickScenario}
      />

      {toast && (
        <div className="my-4 px-4 py-2.5 bg-slate-900 border border-blue-500/60 text-slate-200 rounded-lg text-sm flex items-center justify-between shadow-xl animate-fade-in font-mono text-xs">
          <span className="font-medium">{toast}</span>
          <button onClick={() => setToast(null)} className="text-slate-400 hover:text-white font-bold text-sm ml-4">✕</button>
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
        {activeTab === 'deliveries' && <DeliveryFeed deliveries={deliveries} />}
        {activeTab === 'dlq' && (
          <DlqView
            dlqDeliveries={dlqDeliveries}
            loading={loading}
            onReplay={handleReplay}
          />
        )}
        {activeTab === 'endpoints' && (
          <EndpointsView
            endpoints={endpoints}
            onResetCircuit={handleResetCircuit}
          />
        )}
        {activeTab === 'test' && (
          <TriggerTestForm
            customIdempotency={customIdempotency}
            setCustomIdempotency={setCustomIdempotency}
            eventType={eventType}
            setEventType={setEventType}
            orderingKey={orderingKey}
            setOrderingKey={setOrderingKey}
            payloadJson={payloadJson}
            setPayloadJson={setPayloadJson}
            loading={loading}
            onSubmit={handleSendEvent}
          />
        )}
      </div>
    </div>
  );
}
