import React from 'react';
import { Delivery } from '../types';

interface DeliveryFeedProps {
  deliveries: Delivery[];
}

export const DeliveryFeed: React.FC<DeliveryFeedProps> = ({ deliveries }) => {
  return (
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
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        del.status === 'SUCCESS'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : del.status === 'RETRYING'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-rose-950 text-rose-300 border border-rose-800'
                      }`}
                    >
                      {del.status}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 font-mono text-xs">
                    {del.http_status ? (
                      <span className={del.http_status < 400 ? 'text-emerald-400' : 'text-rose-400'}>
                        {del.http_status}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-6 py-3.5 font-mono text-xs">
                    {del.duration_ms ? `${del.duration_ms}ms` : '—'}
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-400">#{del.attempt_number}</td>
                  <td className="px-6 py-3.5 text-xs text-slate-400">
                    {new Date(del.created_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
