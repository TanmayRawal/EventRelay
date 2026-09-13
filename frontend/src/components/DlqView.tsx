import React from 'react';
import { Delivery } from '../types';

interface DlqViewProps {
  dlqDeliveries: Delivery[];
  loading: boolean;
  onReplay: (deliveryId: string) => void;
}

export const DlqView: React.FC<DlqViewProps> = ({ dlqDeliveries, loading, onReplay }) => {
  return (
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
            <div
              key={d.id}
              className="p-4 bg-slate-900 border border-rose-900/60 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
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
                onClick={() => onReplay(d.id)}
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
  );
};
