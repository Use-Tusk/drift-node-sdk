import { makeRequest, printRequestSummary } from '/app/test-utils.mjs';

await makeRequest('GET', '/api/health');
await makeRequest('GET', '/api/weather');
await makeRequest('GET', '/api/weather?location=London');
await makeRequest('POST', '/api/weather', { body: { location: 'Tokyo' } });

printRequestSummary();
