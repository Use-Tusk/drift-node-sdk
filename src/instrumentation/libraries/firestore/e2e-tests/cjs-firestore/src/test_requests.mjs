import { makeRequest, printRequestSummary } from '/app/test-utils.mjs';

await makeRequest('GET', '/health');
await makeRequest('GET', '/document/get');
await makeRequest('POST', '/document/create', { body: { name: 'Test User', email: 'test@example.com' } });
await makeRequest('POST', '/document/set', { body: { name: 'Set User', email: 'set@example.com' } });
await makeRequest('PUT', '/document/update', { body: { name: 'Updated User' } });
await makeRequest('DELETE', '/document/delete');
await makeRequest('POST', '/collection/add', { body: { name: 'New Product', price: 49.99 } });
await makeRequest('POST', '/collection/doc-autoid', { body: { name: 'Auto Product', price: 29.99 } });
await makeRequest('GET', '/query/get');
await makeRequest('POST', '/transaction/increment');
await makeRequest('POST', '/transaction/transfer');
await makeRequest('POST', '/batch/write');

printRequestSummary();
