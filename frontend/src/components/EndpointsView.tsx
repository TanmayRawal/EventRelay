import React from 'react';
import { Endpoint } from '../types';

interface EndpointsViewProps {
  endpoints: Endpoint[];
  onResetCircuit: (endpointId: string) => void;
}

export const EndpointsView: React.FC<EndpointsViewProps> = ({ endpoints, onResetCircuit }) => {
  return (
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
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold ${
                    ep.circuit_state === 'CLOSED'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                      : ep.circuit_state === 'HALF_OPEN'
                      ? 'bg-amber-950 text-amber-300 border border-amber-700'
                      : 'bg-rose-950 text-rose-300 border border-rose-700'
                  }`}
                >
                  Circuit: {ep.circuit_state || 'CLOSED'}
                </span>
              </div>

              <div className="text-xs text-slate-400 font-mono mt-2 break-all">{ep.url}</div>

              {ep.secret_preview && (
                <div className="text-xs text-slate-500 font-mono mt-1">
                  Secret: <span className="text-slate-400">{ep.secret_preview}</span>
                </div>
              )}

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800 text-xs text-slate-400">
                <span>Rate Limit: <b>{ep.rate_limit_rps} RPS</b></span>
                <span>Failures: <b>{ep.circuit_failures || 0}</b></span>
                {ep.circuit_state === 'OPEN' && (
                  <button
                    onClick={() => onResetCircuit(ep.id)}
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
  );
};
