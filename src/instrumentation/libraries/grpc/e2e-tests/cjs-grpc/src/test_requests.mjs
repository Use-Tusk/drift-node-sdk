import { makeRequest, printRequestSummary } from '/app/test-utils.mjs';

await makeRequest('GET', '/health');
await makeRequest('GET', '/greet/hello');
await makeRequest('GET', '/greet/hello-with-metadata');
await makeRequest('POST', '/greet/custom', { body: { name: 'CustomUser', greeting_type: 'casual' } });
await makeRequest('GET', '/greet/hello-again');
await makeRequest('GET', '/greet/many-times');
await makeRequest('GET', '/calc/add');
await makeRequest('GET', '/calc/subtract');
await makeRequest('GET', '/calc/multiply');
await makeRequest('POST', '/calc/divide', { body: { num1: 20, num2: 4 } });
await makeRequest('GET', '/calc/divide-by-zero');
await makeRequest('GET', '/users/1');
await makeRequest('POST', '/users', { body: { name: 'Test User', email: 'testuser@example.com', age: 28, roles: ['user', 'tester'] } });
await makeRequest('PUT', '/users/1', { body: { name: 'Alice Updated', email: 'alice.updated@example.com', age: 31 } });
await makeRequest('GET', '/users?limit=5&offset=0');
await makeRequest('DELETE', '/users/2');
await makeRequest('GET', '/test/user-not-found');
await makeRequest('GET', '/test/sequential-calls');
await makeRequest('POST', '/test/complex-data');
await makeRequest('POST', '/files/upload');
await makeRequest('GET', '/files/download/file_1');
await makeRequest('GET', '/test/unary-callback-only');
await makeRequest('GET', '/test/unary-options-only');

printRequestSummary();
