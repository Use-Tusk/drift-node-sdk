import test from "ava";
import { initializeEsmLoader, _esmLoaderDeps } from "./esmLoader";

/**
 * Whether the current Node version supports module.register().
 * Mirrors the private supportsModuleRegister() function in esmLoader.ts.
 */
function supportsModuleRegister(): boolean {
  const major = parseInt(process.versions.node.split(".")[0]!, 10);
  const minor = parseInt(process.versions.node.split(".")[1]!, 10);
  return major >= 21 || (major === 20 && minor >= 6) || (major === 18 && minor >= 19);
}

// ---- initializeEsmLoader ----

test("initializeEsmLoader: is a no-op in CJS environment (default test env)", (t) => {
  // Tests run as CJS so _esmLoaderDeps.isCommonJS() returns true by default —
  // the function exits immediately without setting the registration flag.
  const prevFlag = (globalThis as any).__tuskDriftEsmLoaderRegistered;
  initializeEsmLoader();
  t.is((globalThis as any).__tuskDriftEsmLoaderRegistered, prevFlag);
});

test("initializeEsmLoader: skips registration if already registered", (t) => {
  if (!supportsModuleRegister()) {
    t.pass();
    return;
  }

  const originalIsCommonJS = _esmLoaderDeps.isCommonJS;
  _esmLoaderDeps.isCommonJS = () => false;

  const prevFlag = (globalThis as any).__tuskDriftEsmLoaderRegistered;
  (globalThis as any).__tuskDriftEsmLoaderRegistered = true;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const iitm = require("import-in-the-middle") as {
    createAddHookMessageChannel: () => { addHookMessagePort: unknown };
  };
  const originalCreateChannel = iitm.createAddHookMessageChannel;
  let channelCreated = false;
  iitm.createAddHookMessageChannel = () => {
    channelCreated = true;
    return { addHookMessagePort: {} };
  };

  try {
    initializeEsmLoader();
    t.false(channelCreated);
  } finally {
    _esmLoaderDeps.isCommonJS = originalIsCommonJS;
    iitm.createAddHookMessageChannel = originalCreateChannel;
    (globalThis as any).__tuskDriftEsmLoaderRegistered = prevFlag;
  }
});

test("initializeEsmLoader: registers ESM loader hooks when not in CJS and not yet registered", (t) => {
  if (!supportsModuleRegister()) {
    t.pass();
    return;
  }

  const originalIsCommonJS = _esmLoaderDeps.isCommonJS;
  _esmLoaderDeps.isCommonJS = () => false;

  const prevFlag = (globalThis as any).__tuskDriftEsmLoaderRegistered;
  delete (globalThis as any).__tuskDriftEsmLoaderRegistered;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const iitm = require("import-in-the-middle") as {
    createAddHookMessageChannel: () => { addHookMessagePort: unknown };
  };
  const originalCreateChannel = iitm.createAddHookMessageChannel;
  const mockPort = {};
  let channelCreated = false;
  iitm.createAddHookMessageChannel = () => {
    channelCreated = true;
    return { addHookMessagePort: mockPort };
  };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const moduleModule = require("module") as { register?: (...args: unknown[]) => void };
  const originalRegister = moduleModule.register;
  let registerCalled = false;
  let firstRegisterArg: unknown;
  moduleModule.register = (...args: unknown[]) => {
    registerCalled = true;
    firstRegisterArg = args[0];
  };

  try {
    initializeEsmLoader();

    t.true(channelCreated);
    t.true(registerCalled);
    t.is(firstRegisterArg, "import-in-the-middle/hook.mjs");
    t.true((globalThis as any).__tuskDriftEsmLoaderRegistered);
  } finally {
    _esmLoaderDeps.isCommonJS = originalIsCommonJS;
    iitm.createAddHookMessageChannel = originalCreateChannel;
    moduleModule.register = originalRegister;
    (globalThis as any).__tuskDriftEsmLoaderRegistered = prevFlag;
  }
});

test("initializeEsmLoader: warns and returns early when Node version does not support module.register", (t) => {
  const originalIsCommonJS = _esmLoaderDeps.isCommonJS;
  const originalNodeMajor = _esmLoaderDeps.nodeMajor;
  const originalNodeMinor = _esmLoaderDeps.nodeMinor;

  _esmLoaderDeps.isCommonJS = () => false;
  // Node 17 falls through all three conditions in supportsModuleRegister,
  // covering lines 12 and 13, and returning false → exercises the warn path (lines 40-46).
  _esmLoaderDeps.nodeMajor = 17;
  _esmLoaderDeps.nodeMinor = 0;

  const prevFlag = (globalThis as any).__tuskDriftEsmLoaderRegistered;
  delete (globalThis as any).__tuskDriftEsmLoaderRegistered;

  try {
    t.notThrows(() => {
      initializeEsmLoader();
    });
    // Returned early before setting the registration flag.
    t.falsy((globalThis as any).__tuskDriftEsmLoaderRegistered);
  } finally {
    _esmLoaderDeps.isCommonJS = originalIsCommonJS;
    _esmLoaderDeps.nodeMajor = originalNodeMajor;
    _esmLoaderDeps.nodeMinor = originalNodeMinor;
    (globalThis as any).__tuskDriftEsmLoaderRegistered = prevFlag;
  }
});

test("initializeEsmLoader: handles createAddHookMessageChannel error gracefully", (t) => {
  if (!supportsModuleRegister()) {
    t.pass();
    return;
  }

  const originalIsCommonJS = _esmLoaderDeps.isCommonJS;
  _esmLoaderDeps.isCommonJS = () => false;

  const prevFlag = (globalThis as any).__tuskDriftEsmLoaderRegistered;
  delete (globalThis as any).__tuskDriftEsmLoaderRegistered;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const iitm = require("import-in-the-middle") as {
    createAddHookMessageChannel: () => { addHookMessagePort: unknown };
  };
  const originalCreateChannel = iitm.createAddHookMessageChannel;
  iitm.createAddHookMessageChannel = () => {
    throw new Error("channel creation failed");
  };

  try {
    // The try/catch inside initializeEsmLoader must swallow the error.
    t.notThrows(() => {
      initializeEsmLoader();
    });

    // Flag is set to true before the try/catch block, so it stays true.
    t.true((globalThis as any).__tuskDriftEsmLoaderRegistered);
  } finally {
    _esmLoaderDeps.isCommonJS = originalIsCommonJS;
    iitm.createAddHookMessageChannel = originalCreateChannel;
    (globalThis as any).__tuskDriftEsmLoaderRegistered = prevFlag;
  }
});
