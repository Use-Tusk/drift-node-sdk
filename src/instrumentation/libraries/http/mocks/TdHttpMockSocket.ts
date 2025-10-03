import { EventEmitter } from "events";
import { OriginalGlobalUtils } from "../../../../core/utils";

export interface TdHttpMockSocketOptions {
  protocol?: "http" | "https";
  family?: number;
  port?: number;
  hostname?: string;
  host?: string;
}

/**
 * Mock socket implementation for Tusk Drift HTTP replay
 */
export class TdHttpMockSocket extends EventEmitter {
  public authorized?: boolean;
  public _hadError: boolean;
  public connecting: boolean;
  public writableLength: number;
  public bufferSize: number;
  public writable: boolean;
  public readable: boolean;
  public pending: boolean;
  public destroyed: boolean;
  public encrypted?: boolean;
  public timeout: number;
  public localAddress: string;
  public remoteFamily: string;
  public localPort: number;
  public remoteAddress: string;
  public remotePort: number;
  public readableEnded: boolean = false;
  public writableFinished: boolean = false;

  constructor(options: TdHttpMockSocketOptions = {}) {
    super();

    // Set SSL/TLS properties for HTTPS
    if (options.protocol === "https") {
      this.authorized = true;
      this.encrypted = true;
    }

    this.bufferSize = 0;
    this.writableLength = 0;
    this.writable = true;
    this.readable = true;
    this.pending = false;
    this.destroyed = false;
    this.connecting = true;
    this._hadError = false;
    this.timeout = 0;

    // Set up network addressing
    const ipv6 = options.family === 6;
    this.remoteFamily = ipv6 ? "IPv6" : "IPv4";
    this.remoteAddress = ipv6 ? "::1" : "127.0.0.1";
    this.localAddress = this.remoteAddress;

    // Set ports
    const port = options.port || (options.protocol === "https" ? 443 : 80);
    this.remotePort = Number.parseInt(String(port), 10);
    this.localPort = this.remotePort;
  }

  setNoDelay(): this {
    return this;
  }

  setKeepAlive(): this {
    return this;
  }

  resume(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  write(): boolean {
    return false;
  }

  address(): { port: number; family: string; address: string } {
    return {
      port: this.remotePort,
      family: this.remoteFamily,
      address: this.remoteAddress,
    };
  }

  setTimeout(timeoutMs: number, callback?: () => void): this {
    this.timeout = timeoutMs;
    if (callback) {
      this.once("timeout", callback);
    }
    return this;
  }

  /**
   * Artificial delay that will trip socket timeouts when appropriate.
   * Doesn't actually wait for time to pass.
   * Timeout events don't necessarily end the request.
   */
  applyDelay(delayMs: number): void {
    if (this.timeout && delayMs > this.timeout) {
      this.emit("timeout");
    }
  }

  getPeerCertificate(): string {
    const originalDate = OriginalGlobalUtils.getOriginalDate();
    return Buffer.from((Math.random() * 1e4 + originalDate.getTime()).toString()).toString(
      "base64",
    );
  }

  /**
   * Denotes that no more I/O activity should happen on this socket.
   * Sets flags and emits 'close' and optional 'error' events.
   */
  destroy(err?: Error): this {
    if (this.destroyed) {
      return this;
    }

    this.destroyed = true;
    this.writable = false;
    this.readable = false;
    this.writableFinished = true;
    this.readableEnded = true;

    process.nextTick(() => {
      if (err) {
        this._hadError = true;
        this.emit("error", err);
      }
      this.emit("close");
    });

    return this;
  }
}
