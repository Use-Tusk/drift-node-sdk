import { TuskDriftMode } from "../../../core/TuskDrift";
import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";

export interface JsonwebtokenModuleExports {
  verify: Function;
  sign: Function;
  decode: Function;
  JsonWebTokenError: any;
  TokenExpiredError: any;
  NotBeforeError: any;
}

export interface JsonwebtokenInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}

export interface JwtVerifyInputValue {
  token: string;
  secretOrPublicKey?: string | Buffer;
  options?: any;
}

export interface JwtSignInputValue {
  payload: string | Buffer | object;
  secretOrPrivateKey?: string | Buffer;
  options?: any;
}

export interface VerifyQueryConfig {
  token: string;
  secretOrPublicKey?: string | Buffer;
  options?: any;
  callback?: Function;
}

export interface SignQueryConfig {
  payload: string | Buffer | object;
  secretOrPrivateKey?: string | Buffer;
  options?: any;
  callback?: Function;
}
