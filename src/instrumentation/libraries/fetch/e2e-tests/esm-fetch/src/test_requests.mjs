import { makeRequest, printRequestSummary } from '/app/test-utils.mjs';

await makeRequest('GET', '/health');
await makeRequest('GET', '/test/fetch-get');
await makeRequest('POST', '/test/fetch-post', { body: { title: 'test', body: 'test body' } });
await makeRequest('GET', '/test/fetch-headers');
await makeRequest('GET', '/test/fetch-json');
await makeRequest('GET', '/test/fetch-url-object');

printRequestSummary();
