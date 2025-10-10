import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';

// Proto files are in the src directory, not dist
const PROTO_PATH_GREETER = path.join(__dirname, '../../src/grpc/protos/greeter.proto');
const PROTO_PATH_CALCULATOR = path.join(__dirname, '../../src/grpc/protos/calculator.proto');
const PROTO_PATH_USER = path.join(__dirname, '../../src/grpc/protos/user.proto');

// Load proto files
const packageDefinitionGreeter = protoLoader.loadSync(PROTO_PATH_GREETER, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const packageDefinitionCalculator = protoLoader.loadSync(PROTO_PATH_CALCULATOR, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const packageDefinitionUser = protoLoader.loadSync(PROTO_PATH_USER, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const greeterProto = grpc.loadPackageDefinition(packageDefinitionGreeter).greeter as any;
const calculatorProto = grpc.loadPackageDefinition(packageDefinitionCalculator).calculator as any;
const userProto = grpc.loadPackageDefinition(packageDefinitionUser).user as any;

// In-memory user store
const users = new Map<number, any>();
let userIdCounter = 1;

// Initialize with some seed users
users.set(1, {
  id: 1,
  name: 'Alice Johnson',
  email: 'alice@example.com',
  age: 30,
  roles: ['admin', 'user'],
  metadata: {
    created_at: Date.now(),
    updated_at: Date.now(),
    active: true,
  },
});

users.set(2, {
  id: 2,
  name: 'Bob Smith',
  email: 'bob@example.com',
  age: 25,
  roles: ['user'],
  metadata: {
    created_at: Date.now(),
    updated_at: Date.now(),
    active: true,
  },
});

userIdCounter = 3;

// Greeter service implementation
function sayHello(call: any, callback: any) {
  console.log('[gRPC Server] SayHello called with:', call.request);
  const name = call.request.name || 'World';
  const greetingType = call.request.greeting_type || 'formal';

  let message = '';
  if (greetingType === 'casual') {
    message = `Hey ${name}!`;
  } else if (greetingType === 'excited') {
    message = `Hello ${name}!!!`;
  } else {
    message = `Hello, ${name}!`;
  }

  callback(null, {
    message,
    timestamp: Date.now(),
    success: true,
  });
}

function sayHelloAgain(call: any, callback: any) {
  console.log('[gRPC Server] SayHelloAgain called with:', call.request);
  const name = call.request.name || 'World';
  callback(null, {
    message: `Hello again, ${name}!`,
    timestamp: Date.now(),
    success: true,
  });
}

function greetManyTimes(call: any, callback: any) {
  console.log('[gRPC Server] GreetManyTimes called with:', call.request);
  const name = call.request.name || 'World';
  callback(null, {
    message: `Greetings, ${name}! Nice to see you multiple times!`,
    timestamp: Date.now(),
    success: true,
  });
}

// Calculator service implementation
function add(call: any, callback: any) {
  console.log('[gRPC Server] Add called with:', call.request);
  const { num1, num2 } = call.request;
  const result = num1 + num2;
  callback(null, {
    result,
    operation: 'addition',
    success: true,
    error_message: '',
  });
}

function subtract(call: any, callback: any) {
  console.log('[gRPC Server] Subtract called with:', call.request);
  const { num1, num2 } = call.request;
  const result = num1 - num2;
  callback(null, {
    result,
    operation: 'subtraction',
    success: true,
    error_message: '',
  });
}

function multiply(call: any, callback: any) {
  console.log('[gRPC Server] Multiply called with:', call.request);
  const { num1, num2 } = call.request;
  const result = num1 * num2;
  callback(null, {
    result,
    operation: 'multiplication',
    success: true,
    error_message: '',
  });
}

function divide(call: any, callback: any) {
  console.log('[gRPC Server] Divide called with:', call.request);
  const { num1, num2 } = call.request;

  if (num2 === 0) {
    const error = {
      code: grpc.status.INVALID_ARGUMENT,
      details: 'Division by zero is not allowed',
    };
    callback(error);
    return;
  }

  const result = num1 / num2;
  callback(null, {
    result,
    operation: 'division',
    success: true,
    error_message: '',
  });
}

// User service implementation
function getUser(call: any, callback: any) {
  console.log('[gRPC Server] GetUser called with:', call.request);
  const userId = call.request.id;
  const user = users.get(userId);

  if (!user) {
    const error = {
      code: grpc.status.NOT_FOUND,
      details: `User with ID ${userId} not found`,
    };
    callback(error);
    return;
  }

  callback(null, user);
}

function createUser(call: any, callback: any) {
  console.log('[gRPC Server] CreateUser called with:', call.request);
  const newUser = {
    id: userIdCounter++,
    name: call.request.name,
    email: call.request.email,
    age: call.request.age,
    roles: call.request.roles || [],
    metadata: {
      created_at: Date.now(),
      updated_at: Date.now(),
      active: true,
    },
  };

  users.set(newUser.id, newUser);
  callback(null, newUser);
}

function updateUser(call: any, callback: any) {
  console.log('[gRPC Server] UpdateUser called with:', call.request);
  const userId = call.request.id;
  const user = users.get(userId);

  if (!user) {
    const error = {
      code: grpc.status.NOT_FOUND,
      details: `User with ID ${userId} not found`,
    };
    callback(error);
    return;
  }

  const updatedUser = {
    ...user,
    name: call.request.name || user.name,
    email: call.request.email || user.email,
    age: call.request.age || user.age,
    roles: call.request.roles || user.roles,
    metadata: {
      ...user.metadata,
      updated_at: Date.now(),
    },
  };

  users.set(userId, updatedUser);
  callback(null, updatedUser);
}

function deleteUser(call: any, callback: any) {
  console.log('[gRPC Server] DeleteUser called with:', call.request);
  const userId = call.request.id;
  const user = users.get(userId);

  if (!user) {
    const error = {
      code: grpc.status.NOT_FOUND,
      details: `User with ID ${userId} not found`,
    };
    callback(error);
    return;
  }

  users.delete(userId);
  callback(null, {
    success: true,
    message: `User ${userId} deleted successfully`,
  });
}

function listUsers(call: any, callback: any) {
  console.log('[gRPC Server] ListUsers called with:', call.request);
  const limit = call.request.limit || 10;
  const offset = call.request.offset || 0;

  const allUsers = Array.from(users.values());
  const paginatedUsers = allUsers.slice(offset, offset + limit);

  callback(null, {
    users: paginatedUsers,
    total: allUsers.length,
  });
}

export function startGrpcServer(port: number = 50051): grpc.Server {
  const server = new grpc.Server();

  // Add Greeter service
  server.addService(greeterProto.Greeter.service, {
    SayHello: sayHello,
    SayHelloAgain: sayHelloAgain,
    GreetManyTimes: greetManyTimes,
  });

  // Add Calculator service
  server.addService(calculatorProto.Calculator.service, {
    Add: add,
    Subtract: subtract,
    Multiply: multiply,
    Divide: divide,
  });

  // Add User service
  server.addService(userProto.UserService.service, {
    GetUser: getUser,
    CreateUser: createUser,
    UpdateUser: updateUser,
    DeleteUser: deleteUser,
    ListUsers: listUsers,
  });

  server.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(),
    (error, port) => {
      if (error) {
        console.error('[gRPC Server] Failed to start:', error);
        return;
      }
      console.log(`[gRPC Server] Server running on port ${port}`);
      server.start();
    }
  );

  return server;
}
