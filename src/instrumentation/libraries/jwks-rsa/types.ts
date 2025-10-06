import { TuskDriftMode } from "../../../core/TuskDrift";
import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";

export interface JwksRsaModuleExports {
  (options: JwksClientOptions): JwksClient;
}

export interface JwksRsaInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}

export interface JwksClientOptions {
  jwksUri: string;
  rateLimit?: boolean;
  jwksRequestsPerMinute?: number;
  cache?: boolean;
  cacheMaxEntries?: number;
  cacheMaxAge?: number;
  requestHeaders?: { [key: string]: string };
  timeout?: number;
  proxy?: string;
  strictSsl?: boolean;
  [key: string]: any;
}

export interface JwksClient {
  getSigningKey: (
    kid: string,
    callback?: (err: Error | null, key?: SigningKey) => void,
  ) => Promise<SigningKey> | void;
  getSigningKeys: (
    callback?: (err: Error | null, keys?: SigningKey[]) => void,
  ) => Promise<SigningKey[]> | void;
}

export interface SigningKey {
  kid: string;
  nbf?: number;
  publicKey?: string;
  rsaPublicKey?: string;
}
