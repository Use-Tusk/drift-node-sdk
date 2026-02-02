import express from 'express';

const MODE = process.env.TUSK_DRIFT_MODE || 'DISABLED';

async function initSDK() {
  if (MODE !== 'DISABLED') {
    const { TuskDrift } = await import('../../src/core/TuskDrift');
    TuskDrift.initialize({
      apiKey: 'benchmark-key',
      env: 'benchmark',
      logLevel: 'error',
    });
  }
}

await initSDK();

const app = express();
app.use(express.json());

const DELAY_SERVER = process.env.DELAY_SERVER || 'http://127.0.0.1:9999';

app.get('/health', (_req, res) => res.send('ok'));

app.post('/api/sort', (req, res) => {
  const sorted = [...req.body.data].sort((a: number, b: number) => a - b);
  res.json({ sorted });
});

app.post('/api/downstream', async (req, res) => {
  const delayMs = req.body.delay_ms || 10;
  await fetch(`${DELAY_SERVER}/delay?ms=${delayMs}`);
  res.json({ status: 'ok' });
});

const port = parseInt(process.env.PORT || '8080');
app.listen(port, '127.0.0.1');
