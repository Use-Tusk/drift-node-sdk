// Simple gRPC server for integration tests
// This runs in Docker and provides test services for the integration tests to call

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_PATH_GREETER = path.join(__dirname, 'protos/greeter.proto');
const PROTO_PATH_CALCULATOR = path.join(__dirname, 'protos/calculator.proto');
const PROTO_PATH_USER = path.join(__dirname, 'protos/user.proto');
const PROTO_PATH_FILE = path.join(__dirname, 'protos/file.proto');

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

const packageDefinitionFile = protoLoader.loadSync(PROTO_PATH_FILE, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const greeterProto = grpc.loadPackageDefinition(packageDefinitionGreeter).greeter;
const calculatorProto = grpc.loadPackageDefinition(packageDefinitionCalculator).calculator;
const userProto = grpc.loadPackageDefinition(packageDefinitionUser).user;
const fileProto = grpc.loadPackageDefinition(packageDefinitionFile).file;

// In-memory user store
const users = new Map();
let userIdCounter = 1;

// Initialize with seed users
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
function sayHello(call, callback) {
  console.log('[gRPC Server] SayHello called');
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

function sayHelloAgain(call, callback) {
  console.log('[gRPC Server] SayHelloAgain called');
  const name = call.request.name || 'World';
  callback(null, {
    message: `Hello again, ${name}!`,
    timestamp: Date.now(),
    success: true,
  });
}

function greetManyTimes(call, callback) {
  console.log('[gRPC Server] GreetManyTimes called');
  const name = call.request.name || 'World';
  callback(null, {
    message: `Greetings, ${name}! Nice to see you multiple times!`,
    timestamp: Date.now(),
    success: true,
  });
}

// Calculator service implementation
function add(call, callback) {
  console.log('[gRPC Server] Add called');
  const { num1, num2 } = call.request;
  const result = num1 + num2;
  callback(null, {
    result,
    operation: 'addition',
    success: true,
    error_message: '',
  });
}

function subtract(call, callback) {
  console.log('[gRPC Server] Subtract called');
  const { num1, num2 } = call.request;
  const result = num1 - num2;
  callback(null, {
    result,
    operation: 'subtraction',
    success: true,
    error_message: '',
  });
}

function multiply(call, callback) {
  console.log('[gRPC Server] Multiply called');
  const { num1, num2 } = call.request;
  const result = num1 * num2;
  callback(null, {
    result,
    operation: 'multiplication',
    success: true,
    error_message: '',
  });
}

function divide(call, callback) {
  console.log('[gRPC Server] Divide called');
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
function getUser(call, callback) {
  console.log('[gRPC Server] GetUser called');
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

function createUser(call, callback) {
  console.log('[gRPC Server] CreateUser called');
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

function updateUser(call, callback) {
  console.log('[gRPC Server] UpdateUser called');
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

function deleteUser(call, callback) {
  console.log('[gRPC Server] DeleteUser called');
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

function listUsers(call, callback) {
  console.log('[gRPC Server] ListUsers called');
  const limit = call.request.limit || 10;
  const offset = call.request.offset || 0;

  const allUsers = Array.from(users.values());
  const paginatedUsers = allUsers.slice(offset, offset + limit);

  callback(null, {
    users: paginatedUsers,
    total: allUsers.length,
  });
}

// File service implementation
const files = new Map();
let fileIdCounter = 1;

function uploadFile(call, callback) {
  console.log('[gRPC Server] UploadFile called');
  const { filename, content, content_type } = call.request;

  const fileId = `file_${fileIdCounter++}`;

  // Store the file
  files.set(fileId, {
    filename,
    content,
    content_type,
  });

  // Create a thumbnail with binary data
  const thumbnailData = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG header
    Buffer.from('THUMBNAIL'),
    content.slice(0, 10),
  ]);

  callback(null, {
    file_id: fileId,
    size: content.length,
    thumbnail: thumbnailData,
    message: `File ${filename} uploaded successfully`,
  });
}

function downloadFile(call, callback) {
  console.log('[gRPC Server] DownloadFile called');
  const { file_id } = call.request;

  const file = files.get(file_id);
  if (!file) {
    const error = {
      code: grpc.status.NOT_FOUND,
      details: `File with ID ${file_id} not found`,
    };
    callback(error);
    return;
  }

  callback(null, {
    filename: file.filename,
    content: file.content,
    content_type: file.content_type,
    size: file.content.length,
  });
}

// Start the server
function main() {
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

  // Add File service
  server.addService(fileProto.FileService.service, {
    UploadFile: uploadFile,
    DownloadFile: downloadFile,
  });

  server.bindAsync(
    '0.0.0.0:50051',
    grpc.ServerCredentials.createInsecure(),
    (error, port) => {
      if (error) {
        console.error('[gRPC Server] Failed to start:', error);
        process.exit(1);
      }
      console.log(`[gRPC Server] Server running on port ${port}`);
      server.start();
    }
  );
}

main();
