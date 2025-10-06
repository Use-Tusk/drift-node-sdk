import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { JwksRsaModuleExports, JwksRsaInstrumentationConfig } from "./types";
import { logger } from "../../../core/utils/logger";

/**
 * JwksRsa is just patched to override rate limits enforced on the client side in replay mode
 *
 * No spans are being recorded or replayed for jwks-rsa.
 */
export class JwksRsaInstrumentation extends TdInstrumentationBase {
  private tuskDrift: TuskDriftCore;

  constructor(config: JwksRsaInstrumentationConfig = {}) {
    super("jwks-rsa", config);
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "jwks-rsa",
        supportedVersions: ["1.*", "2.*", "3.*"],
        patch: (moduleExports: JwksRsaModuleExports) => this._patchJwksRsaModule(moduleExports),
      }),
    ];
  }

  private _patchJwksRsaModule(jwksModule: any): any {
    logger.debug(
      `[JwksRsaInstrumentation] Patching jwks-rsa module, current mode: ${this.tuskDrift.getMode()}`,
    );

    if (this.isModulePatched(jwksModule)) {
      logger.debug(`[JwksRsaInstrumentation] jwks-rsa module already patched, skipping`);
      return jwksModule;
    }

    const self = this;

    if (jwksModule.expressJwtSecret) {
      const originalExpressJwtSecret = jwksModule.expressJwtSecret;
      jwksModule.expressJwtSecret = function (options: any) {
        logger.debug(`[JwksRsaInstrumentation] expressJwtSecret called with options:`, options);
        const modifiedOptions = { ...options };
        // Only disable rate limiting in replay mode
        if (self.tuskDrift.getMode() === TuskDriftMode.REPLAY) {
          logger.debug(
            `[JwksRsaInstrumentation] REPLAY MODE - Disabling rate limiting for expressJwtSecret`,
          );
          modifiedOptions.rateLimit = false;
          delete modifiedOptions.jwksRequestsPerMinute;
          logger.debug(`[JwksRsaInstrumentation] Modified options:`, modifiedOptions);
        }
        return originalExpressJwtSecret(modifiedOptions);
      };
      logger.debug(`[JwksRsaInstrumentation] Patched expressJwtSecret method`);
    }

    this.markModuleAsPatched(jwksModule);

    logger.debug(`[JwksRsaInstrumentation] jwks-rsa module patching complete`);
    return jwksModule;
  }
}
