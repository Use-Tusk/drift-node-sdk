import { makeRequest, printRequestSummary } from '/app/test-utils.mjs';

await makeRequest('GET', '/health');
await makeRequest('GET', '/test/basic-query');
await makeRequest('POST', '/test/parameterized-query', { body: { userId: 1 } });
await makeRequest('GET', '/test/client-query');
await makeRequest('GET', '/test/client-connect');
await makeRequest('GET', '/test/client-close');
await makeRequest('GET', '/test/pool-query');
await makeRequest('POST', '/test/pool-parameterized', { body: { userId: 2 } });
await makeRequest('GET', '/test/pool-connect');
await makeRequest('GET', '/test/pool-transaction');
await makeRequest('GET', '/test/query-rowmode-array');
await makeRequest('GET', '/test/multi-statement');

printRequestSummary();
