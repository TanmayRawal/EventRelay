const express = require('express');
const app = express();
app.use(express.json());

let requestCount = 0;

app.post('/webhook/success', (req, res) => {
  console.log('[Mock:Success] Received event:', req.header('X-EventRelay-Event-ID'), req.body);
  res.status(200).json({ status: 'acknowledged', receivedAt: new Date() });
});

app.post('/webhook/flaky', (req, res) => {
  requestCount++;
  if (requestCount % 2 === 1) {
    console.warn('[Mock:Flaky] Simulating temporary failure (HTTP 500)');
    return res.status(500).json({ error: 'Database lock timeout. Please retry.' });
  }
  console.log('[Mock:Flaky] Simulating successful retry (HTTP 200)');
  res.status(200).json({ status: 'recovered', attempts: requestCount });
});

app.post('/webhook/failing', (req, res) => {
  console.error('[Mock:Failing] Simulating hard outage (HTTP 503)');
  res.status(503).json({ error: 'Service Unavailable. Outage in progress.' });
});

app.post('/webhook/slow', async (req, res) => {
  console.log('[Mock:Slow] Simulating 6s hanging connection...');
  await new Promise((r) => setTimeout(r, 6000));
  res.status(200).json({ status: 'finally completed' });
});

const PORT = process.env.PORT || 9000;
app.listen(PORT, () => {
  console.log(`[MockReceiver] Mock webhook endpoint listening on port ${PORT}`);
});
