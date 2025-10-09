import type {
  Agent,
  ClientRequest,
  IncomingMessage,
  OutgoingMessage,
  Server,
  ServerResponse,
  IncomingHttpHeaders,
} from "http";
import { HttpBodyType } from "./utils";

export type HttpProtocol = "http" | "https";

export interface HttpClientInputValue {
  method: string;
  path?: string;
  headers: Record<string, unknown>;
  protocol: HttpProtocol;
  hostname?: string;
  port?: number;
  timeout?: number;
  body?: unknown;
  bodySize?: number;
  bodyType?: HttpBodyType;
  hasBodyParsingError?: boolean;
  [key: string]: unknown;
}

export interface HttpClientOutputValue {
  statusCode?: number;
  statusMessage?: string;
  headers: Record<string, string>;
  httpVersion: string;
  httpVersionMajor: number;
  httpVersionMinor: number;
  complete: boolean;
  readable: boolean;
  body?: string;
  bodySize?: number;
  bodyProcessingError?: string;
  errorName?: string
  errorMessage?: string
  [key: string]: unknown;
}

export interface HttpServerInputValue {
  method?: string;
  url: string;
  target?: string;
  body: any;
  bodySize: number;
  headers: IncomingHttpHeaders;
  httpVersion: string;
  remoteAddress?: string;
  remotePort?: number;
  [key: string]: unknown;
}

export interface HttpServerOutputValue {
  statusCode?: number;
  statusMessage?: string;
  headers: Record<string, string>;
  body?: string;
  bodySize?: number;
  bodyProcessingError?: string;
  [key: string]: unknown;
}

export interface HttpModuleExports {
  default?: any;
  _connectionListener: Function;
  METHODS: string[];
  STATUS_CODES: { [code: number]: string };
  Agent: typeof Agent;
  ClientRequest: typeof ClientRequest;
  IncomingMessage: typeof IncomingMessage;
  OutgoingMessage: typeof OutgoingMessage;
  Server: typeof Server;
  ServerResponse: typeof ServerResponse;
  createServer: Function;
  validateHeaderName: Function;
  validateHeaderValue: Function;
  get: Function;
  request: Function;
  setMaxIdleHTTPParsers: Function;
  maxHeaderSize: number;
  globalAgent: Agent;
  // Custom property added by our instrumentation
}

export interface HttpsModuleExports {
  default?: any;
  Agent: typeof Agent;
  globalAgent: Agent;
  Server: typeof Server;
  createServer: Function;
  get: Function;
  request: Function;
  // Custom property added by our instrumentation
}
