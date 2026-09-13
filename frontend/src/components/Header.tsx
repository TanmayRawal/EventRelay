import React from 'react';

interface HeaderProps {
  successRate: number;
  totalDelivered: number;
  dlqCount: number;
}

export const Header: React.FC<HeaderProps> = ({ successRate, totalDelivered, dlqCount }) => {
  return (
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

      <div className="grid grid-cols-3 gap-4 mt-4 md:mt-0">
        <div className="bg-slate-800/70 border border-slate-700/60 rounded-lg p-3 text-center">
          <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Success Rate</div>
          <div className="text-xl font-bold text-emerald-400">{successRate}%</div>
        </div>
        <div className="bg-slate-800/70 border border-slate-700/60 rounded-lg p-3 text-center">
          <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Total Delivered</div>
          <div className="text-xl font-bold text-blue-400">{totalDelivered}</div>
        </div>
        <div className="bg-slate-800/70 border border-slate-700/60 rounded-lg p-3 text-center">
          <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">DLQ Failures</div>
          <div className={`text-xl font-bold ${dlqCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
            {dlqCount}
          </div>
        </div>
      </div>
    </header>
  );
};
