import { TuskDrift } from './tdInit.js';
import http from 'http';
import https from 'https';
import axios from 'axios';

// Create HTTP server with test endpoints
const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';

  console.log(`Received request: ${method} ${url}`);

  try {
    // Test raw http.get
    if (url === '/test-http-get' && method === 'GET') {
      const result = await new Promise<string>((resolve, reject) => {
        http.get('https://jsonplaceholder.typicode.com/posts/1', (response) => {
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => {
            resolve(data);
          });
        }).on('error', reject);
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        endpoint: '/test-http-get',
        result: JSON.parse(result),
      }));
      return;
    }

    // Test raw http.request
    if (url === '/test-http-request' && method === 'POST') {
      const result = await new Promise<string>((resolve, reject) => {
        const options = {
          hostname: 'jsonplaceholder.typicode.com',
          port: 443,
          path: '/posts',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        };

        const request = https.request(options, (response) => {
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => {
            resolve(data);
          });
        });

        request.on('error', reject);
        request.write(JSON.stringify({ test: 'data' }));
        request.end();
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        endpoint: '/test-http-request',
        result: JSON.parse(result),
      }));
      return;
    }

    // Test https.get
    if (url === '/test-https-get' && method === 'GET') {
      const result = await new Promise<string>((resolve, reject) => {
        https.get('https://jsonplaceholder.typicode.com/posts/1', (response) => {
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => {
            resolve(data);
          });
        }).on('error', reject);
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        endpoint: '/test-https-get',
        result: JSON.parse(result),
      }));
      return;
    }

    // Test axios GET
    if (url === '/test-axios-get' && method === 'GET') {
      const response = await axios.get('https://jsonplaceholder.typicode.com/posts/1');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        endpoint: '/test-axios-get',
        result: response.data,
      }));
      return;
    }

    // Test axios POST
    if (url === '/test-axios-post' && method === 'POST') {
      const response = await axios.post('https://jsonplaceholder.typicode.com/posts', {
        test: 'data from axios',
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        endpoint: '/test-axios-post',
        result: response.data,
      }));
      return;
    }

    // Health check endpoint
    if (url === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy' }));
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    console.error('Error handling request:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    }));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  TuskDrift.markAppAsReady();
  console.log(`Server running on port ${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  /health - Health check');
  console.log('  GET  /test-http-get - Test raw http.get');
  console.log('  POST /test-http-request - Test raw http.request');
  console.log('  GET  /test-https-get - Test https.get');
  console.log('  GET  /test-axios-get - Test axios GET');
  console.log('  POST /test-axios-post - Test axios POST');
});
