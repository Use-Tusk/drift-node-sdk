import { makeRequest, printRequestSummary } from '/app/test-utils.mjs';

await makeRequest('GET', '/health');
await makeRequest('GET', '/users/all');
await makeRequest('GET', '/users/active');
await makeRequest('GET', '/users/1');
await makeRequest('GET', '/users/first-active');
await makeRequest('GET', '/users/by-email/alice@example.com');
await makeRequest('POST', '/users/create', { body: { email: 'newuser@example.com', name: 'New User', age: 28 } });
await makeRequest('POST', '/users/create-many');
await makeRequest('PUT', '/users/1', { body: { name: 'Updated Alice', age: 31 } });
await makeRequest('PUT', '/users/bulk-deactivate');
await makeRequest('POST', '/users/upsert', { body: { email: 'upsert@example.com', name: 'Upsert User', age: 29 } });
await makeRequest('GET', '/users/count');
await makeRequest('GET', '/orders/aggregate');
await makeRequest('GET', '/users/1/with-posts');
await makeRequest('GET', '/posts/published');
await makeRequest('POST', '/posts/create-with-author', { body: { title: 'Nested Post', content: 'Test content', authorEmail: 'alice@example.com' } });
await makeRequest('POST', '/transactions/sequential');
await makeRequest('POST', '/transactions/interactive');
await makeRequest('POST', '/raw/query');
await makeRequest('POST', '/raw/execute');
await makeRequest('POST', '/errors/unique-violation');
await makeRequest('GET', '/errors/not-found');
await makeRequest('POST', '/errors/validation');
await makeRequest('DELETE', '/users/inactive');

printRequestSummary();
