import React from 'react';
import { ScenarioType } from '../types';

interface InteractiveDemoBarProps {
  loading: boolean;
  onRunScenario: (scenario: ScenarioType) => void;
}

export const InteractiveDemoBar: React.FC<InteractiveDemoBarProps> = ({ loading, onRunScenario }) => {
  return (
    <section className="mt-6 p-5 bg-gradient-to-r from-slate-900 via-slate-800/80 to-slate-900 border border-blue-500/30 rounded-xl shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-700/60">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <h2 className="text-sm font-bold text-white tracking-wide uppercase">
              Interactive Live Demo — Try Scenarios in 1-Click
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Click any button below to see how EventRelay solves real distributed systems failures in real time:
          </p>
        </div>
        <span className="text-xs font-mono text-blue-400 self-start sm:self-center bg-blue-950/80 px-2 py-1 rounded border border-blue-800">
          {loading ? 'Processing Dispatch...' : 'Ready for Simulation'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3.5">
        {/* Scenario 1 */}
        <button
          onClick={() => onRunScenario('happy')}
          disabled={loading}
          className="p-3 bg-slate-800/90 hover:bg-slate-700/90 border border-emerald-500/40 rounded-lg text-left transition-all hover:scale-[1.02] active:scale-95 group disabled:opacity-50"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-400 uppercase">Scenario 1</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono font-semibold">200 OK</span>
          </div>
          <div className="text-sm font-semibold text-white mt-1 group-hover:text-emerald-300">
            Happy Path Payment
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Signs payload with HMAC-SHA256 and dispatches in &lt;5ms.
          </p>
        </button>

        {/* Scenario 2 */}
        <button
          onClick={() => onRunScenario('idempotent')}
          disabled={loading}
          className="p-3 bg-slate-800/90 hover:bg-slate-700/90 border border-amber-500/40 rounded-lg text-left transition-all hover:scale-[1.02] active:scale-95 group disabled:opacity-50"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-400 uppercase">Scenario 2</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 font-mono font-semibold">Deduplicated</span>
          </div>
          <div className="text-sm font-semibold text-white mt-1 group-hover:text-amber-300">
            Double-Click Guard
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Fires duplicate key; blocks 2nd charge with zero duplicate inserts.
          </p>
        </button>

        {/* Scenario 3 */}
        <button
          onClick={() => onRunScenario('circuit')}
          disabled={loading}
          className="p-3 bg-slate-800/90 hover:bg-slate-700/90 border border-rose-500/40 rounded-lg text-left transition-all hover:scale-[1.02] active:scale-95 group disabled:opacity-50"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-400 uppercase">Scenario 3</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 font-mono font-semibold">Trip OPEN</span>
          </div>
          <div className="text-sm font-semibold text-white mt-1 group-hover:text-rose-300">
            Simulate 503 Outage
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Fires 5 errors; trips circuit to OPEN to fast-fail in 0ms.
          </p>
        </button>

        {/* Scenario 4 */}
        <button
          onClick={() => onRunScenario('dlq')}
          disabled={loading}
          className="p-3 bg-slate-800/90 hover:bg-slate-700/90 border border-purple-500/40 rounded-lg text-left transition-all hover:scale-[1.02] active:scale-95 group disabled:opacity-50"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-400 uppercase">Scenario 4</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 font-mono font-semibold">1-Click Fix</span>
          </div>
          <div className="text-sm font-semibold text-white mt-1 group-hover:text-purple-300">
            DLQ Manual Replay
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Re-enqueues dead-lettered webhooks once partner recovers.
          </p>
        </button>
      </div>
    </section>
  );
};
