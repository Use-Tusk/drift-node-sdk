export default {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.ts", "**/*.test.ts", "**/*.test.int.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.test.json",
      },
    ],
  },
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!src/**/*.test.ts", "!src/**/*.spec.ts"],
  moduleFileExtensions: ["ts", "js", "json", "node"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  verbose: true,
  // TODO: Some integration tests are really slow for some reason
  testTimeout: 30000,
};
