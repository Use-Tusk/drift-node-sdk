export const TuskDriftInstrumentationModuleNames = [
  "http",
  "https",
  "pg",
  "postgres",
  "node-fetch",
  "graphql",
  "jsonwebtoken",
  "jwks-rsa",
  "mysql2",
  "ioredis",
  "@upstash/redis",
  "@grpc/grpc-js",
  "@prisma/client",
  "@google-cloud/firestore",
  // Note: "next" is intentionally excluded from this list because Next.js is always
  // required before SDK initialization in Next.js apps.
  // Our Next.js instrumentation handles this case correctly by patching at runtime
  // rather than relying on require-in-the-middle hooks.
];
