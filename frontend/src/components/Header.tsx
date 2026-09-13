import React, { useState } from 'react';

interface HeaderProps {
  successRate: number;
  totalDelivered: number;
  dlqCount: number;
  apiKey: string;
  onUpdateApiKey: (newKey: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  successRate,
  totalDelivered,
  dlqCount,
  apiKey,
  onUpdateApiKey
}) => {
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);

  const handleSaveKey = () => {
    onUpdateApiKey(tempKey.trim());
    setIsEditingKey(false);
  };

  return (
    <header className="flex flex-col md:flex-row md:items-center md:justify-between pb-6 border-b border-slate-800">
      <div>
        <div className="flex items-center gap-3 flex-wrap">
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

        {/* API Key Status / Editor */}
        <div className="mt-2.5 flex items-center gap-2 text-xs">
          <span className="text-slate-500 font-medium">Gateway Auth:</span>
          {isEditingKey ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={tempKey}
                onChange={(e) => setTempKey(e.target.value)}
                placeholder="Enter API Key"
                className="bg-slate-900 border border-blue-500 text-white font-mono px-2 py-0.5 rounded text-xs focus:outline-none"
              />
              <button
                onClick={handleSaveKey}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-0.5 rounded font-semibold text-xs"
              >
                Save
              </button>
              <button
                onClick={() => { setIsEditingKey(false); setTempKey(apiKey); }}
                className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-0.5 rounded text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className={`font-mono px-2 py-0.5 rounded border text-xs ${
                apiKey
                  ? 'bg-slate-800 text-emerald-400 border-slate-700'
                  : 'bg-slate-800/60 text-slate-400 border-slate-700'
              }`}>
                {apiKey ? `${apiKey.slice(0, 10)}••••••••` : 'Unconfigured (Open Mode)'}
              </span>
              <button
                onClick={() => { setTempKey(apiKey); setIsEditingKey(true); }}
                className="text-blue-400 hover:text-blue-300 underline text-xs"
              >
                Configure
              </button>
            </div>
          )}
        </div>
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
