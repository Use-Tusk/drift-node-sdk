import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';

// Proto files are in the src directory, not dist
const PROTO_PATH_GREETER = path.join(__dirname, '../../src/grpc/protos/greeter.proto');
const PROTO_PATH_CALCULATOR = path.join(__dirname, '../../src/grpc/protos/calculator.proto');
const PROTO_PATH_USER = path.join(__dirname, '../../src/grpc/protos/user.proto');

const GRPC_SERVER_ADDRESS = process.env.GRPC_SERVER_ADDRESS || 'localhost:50051';

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

// Declare clients as variables that will be initialized later
export let greeterClient: any;
export let calculatorClient: any;
export let userClient: any;

// Initialize clients - must be called after instrumentation is set up
export function initializeClients() {
  console.log('[gRPC Clients] Initializing clients for server:', GRPC_SERVER_ADDRESS);

  const greeterProto = grpc.loadPackageDefinition(packageDefinitionGreeter).greeter as any;
  const calculatorProto = grpc.loadPackageDefinition(packageDefinitionCalculator).calculator as any;
  const userProto = grpc.loadPackageDefinition(packageDefinitionUser).user as any;

  greeterClient = new greeterProto.Greeter(
    GRPC_SERVER_ADDRESS,
    grpc.credentials.createInsecure()
  );

  calculatorClient = new calculatorProto.Calculator(
    GRPC_SERVER_ADDRESS,
    grpc.credentials.createInsecure()
  );

  userClient = new userProto.UserService(
    GRPC_SERVER_ADDRESS,
    grpc.credentials.createInsecure()
  );

  console.log('[gRPC Clients] Clients initialized successfully');
}

// Helper function to promisify gRPC calls
export function grpcCallPromise<TRequest, TResponse>(
  client: any,
  methodName: string,
  request: TRequest,
  metadata?: grpc.Metadata
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const meta = metadata || new grpc.Metadata();
    client[methodName](request, meta, (error: grpc.ServiceError | null, response: TResponse) => {
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    });
  });
}
