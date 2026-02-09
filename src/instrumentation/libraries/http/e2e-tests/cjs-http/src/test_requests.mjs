import { makeRequest, printRequestSummary } from '/app/test-utils.mjs';

await makeRequest('GET', '/health');
await makeRequest('GET', '/test-http-get');
await makeRequest('POST', '/test-http-request');
await makeRequest('GET', '/test-https-get');
await makeRequest('GET', '/test-axios-get');
await makeRequest('POST', '/test-axios-post');
await makeRequest('GET', '/test-url-object-get');
await makeRequest('POST', '/test-url-object-request');

printRequestSummary();
