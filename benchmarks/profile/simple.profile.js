"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const dist_1 = require("../../dist");
const tinybench_1 = require("tinybench");
dist_1.TuskDrift.initialize({
    apiKey: "benchmark-test-key",
    env: "benchmark",
    logLevel: "info",
});
const test_server_1 = require("../server/test-server");
dist_1.TuskDrift.markAppAsReady();
let server;
let serverUrl;
function startup() {
    return __awaiter(this, void 0, void 0, function* () {
        server = new test_server_1.TestServer();
        const info = yield server.start();
        serverUrl = info.url;
        console.log(`\nTest server started at ${serverUrl}`);
    });
}
function teardown() {
    return __awaiter(this, void 0, void 0, function* () {
        yield server.stop();
        console.log("Test server stopped\n");
    });
}
(() => __awaiter(void 0, void 0, void 0, function* () {
    yield startup();
    const bench = new tinybench_1.Bench({
        time: 10000,
        warmupTime: 1000,
        warmupIterations: 100,
        now: tinybench_1.hrtimeNow,
    });
    bench.add("High Throughput: GET /api/simple", () => __awaiter(void 0, void 0, void 0, function* () {
        const response = yield fetch(`${serverUrl}/api/simple`);
        yield response.json();
    }));
    yield bench.run();
    console.table(bench.table());
    yield teardown();
}))().catch(console.error);
