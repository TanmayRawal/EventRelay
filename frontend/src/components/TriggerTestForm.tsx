import React from 'react';

interface TriggerTestFormProps {
  customIdempotency: string;
  setCustomIdempotency: (val: string) => void;
  eventType: string;
  setEventType: (val: string) => void;
  orderingKey: string;
  setOrderingKey: (val: string) => void;
  payloadJson: string;
  setPayloadJson: (val: string) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export const TriggerTestForm: React.FC<TriggerTestFormProps> = ({
  customIdempotency,
  setCustomIdempotency,
  eventType,
  setEventType,
  orderingKey,
  setOrderingKey,
  payloadJson,
  setPayloadJson,
  loading,
  onSubmit,
}) => {
  return (
    <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-white mb-1">Simulate Business Event Dispatch</h2>
      <p className="text-sm text-slate-400 mb-6">
        Dispatches an event payload with an Idempotency-Key and optional Ordering Key (hashed to virtual Redis Stream shards for FIFO per-entity delivery).
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
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
          <label className="block text-xs font-semibold text-slate-300 mb-1">Ordering Key (Optional Virtual Shard Key)</label>
          <input
            type="text"
            placeholder="e.g. customer_101@example.com or order_123"
            value={orderingKey}
            onChange={(e) => setOrderingKey(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500"
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
          {loading ? 'Dispatching to Redis Streams...' : 'Ingest & Queue Webhook Event'}
        </button>
      </form>
    </div>
  );
};
