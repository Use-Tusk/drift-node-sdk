import { createAddHookMessageChannel } from "import-in-the-middle";
import * as moduleModule from "module";
import { logger } from "./utils";
import { isCommonJS } from "./utils/runtimeDetectionUtils";

const NODE_MAJOR = parseInt(process.versions.node.split(".")[0]!, 10);
const NODE_MINOR = parseInt(process.versions.node.split(".")[1]!, 10);

function supportsModuleRegister(): boolean {
  return (
    NODE_MAJOR >= 21 ||
    (NODE_MAJOR === 20 && NODE_MINOR >= 6) ||
    (NODE_MAJOR === 18 && NODE_MINOR >= 19)
  );
}

/**
 * Automatically register ESM loader hooks via `import-in-the-middle` so that
 * ESM imports can be intercepted for instrumentation.
 *
 * In CJS mode this is a no-op because `require-in-the-middle` handles
 * interception. On Node versions that lack `module.register` support
 * (< 18.19, < 20.6) we log a warning and skip.
 *
 * https://nodejs.org/api/module.html#moduleregisterspecifier-parenturl-options
 */
export function initializeEsmLoader(): void {
  if (isCommonJS()) {
    return;
  }

  if (!supportsModuleRegister()) {
    logger.warn(
      `Node.js ${process.versions.node} does not support module.register(). ` +
        `ESM loader hooks will not be registered automatically. ` +
        `Upgrade to Node.js >= 18.19.0 or >= 20.6.0, or register the hooks manually.`,
    );
    return;
  }

  if ((globalThis as any).__tuskDriftEsmLoaderRegistered) {
    return;
  }
  (globalThis as any).__tuskDriftEsmLoaderRegistered = true;

  try {
    // createAddHookMessageChannel sets up a MessagePort so the main thread can
    // send new hook registrations (from `new Hook(...)` calls in userland) to
    // the loader thread, which runs in a separate context.
    const { addHookMessagePort } = createAddHookMessageChannel();

    // The IITM loader hook module that intercepts ESM imports.
    // Resolved relative to this SDK package (import.meta.url) so the hook
    // module is found from node_modules regardless of the user's cwd.
    // @ts-expect-error register exists on module in supported Node versions
    moduleModule.register("import-in-the-middle/hook.mjs", import.meta.url, {
      // Payload sent to the loader hook's initialize() function:
      // - addHookMessagePort: the MessagePort for main↔loader communication
      // - include: [] starts with an empty allowlist; only modules registered
      //   via new Hook([...]) on the main thread get added dynamically through
      //   the MessagePort, so only instrumented modules are wrapped.
      data: { addHookMessagePort, include: [] },
      // Transfer (not clone) the port — a MessagePort can only be owned by one thread
      transferList: [addHookMessagePort],
    });
    logger.debug("ESM loader hooks registered successfully");
  } catch (error) {
    logger.warn("Failed to register ESM loader hooks:", error);
  }
}
