import { randomBytes } from "@libp2p/crypto";
import { ProtocolError, TimeoutError } from "@libp2p/interface";
import { byteStream } from "it-byte-stream";
import { equals as uint8ArrayEquals } from "uint8arrays/equals";
import {
  PROTOCOL_PREFIX,
  PROTOCOL_NAME,
  PING_LENGTH,
  PROTOCOL_VERSION,
  TIMEOUT,
  MAX_INBOUND_STREAMS,
  MAX_OUTBOUND_STREAMS,
} from "./constants.js";
import type {
  PingServiceComponents,
  PingServiceInit,
  PingService as PingServiceInterface,
} from "./index.js";
import type {
  AbortOptions,
  Logger,
  Stream,
  PeerId,
  Startable,
  Connection,
} from "@libp2p/interface";
import type { IncomingStreamData } from "@libp2p/interface-internal";
import type { Multiaddr } from "@multiformats/multiaddr";

export class PingService implements Startable, PingServiceInterface {
  public readonly protocol: string;
  private readonly components: PingServiceComponents;
  private started: boolean;
  private readonly timeout: number;
  private readonly maxInboundStreams: number;
  private readonly maxOutboundStreams: number;
  private readonly runOnLimitedConnection: boolean;
  private readonly log: Logger;

  constructor(components: PingServiceComponents, init: PingServiceInit = {}) {
    this.components = components;
    this.log = components.logger.forComponent("libp2p:ping");
    this.started = false;
    this.protocol = `/${init.protocolPrefix ?? PROTOCOL_PREFIX}/${PROTOCOL_NAME}/${PROTOCOL_VERSION}`;
    this.timeout = init.timeout ?? TIMEOUT;
    this.maxInboundStreams = init.maxInboundStreams ?? MAX_INBOUND_STREAMS;
    this.maxOutboundStreams = init.maxOutboundStreams ?? MAX_OUTBOUND_STREAMS;
    this.runOnLimitedConnection = init.runOnLimitedConnection ?? true;

    this.handleMessage = this.handleMessage.bind(this);
  }

  readonly [Symbol.toStringTag] = "@libp2p/ping";

  async start(): Promise<void> {
    await this.components.registrar.handle(this.protocol, this.handleMessage, {
      maxInboundStreams: this.maxInboundStreams,
      maxOutboundStreams: this.maxOutboundStreams,
      runOnLimitedConnection: this.runOnLimitedConnection,
    });
    this.started = true;
  }

  async stop(): Promise<void> {
    await this.components.registrar.unhandle(this.protocol);
    this.started = false;
  }

  isStarted(): boolean {
    return this.started;
  }

  /**
   * A handler to register with Libp2p to process ping messages
   */
  handleMessage(data: IncomingStreamData): void {
    this.log("incoming ping from %p", data.connection.remotePeer);

    const { stream } = data;
    const start = Date.now();
    const bytes = byteStream(stream);

    Promise.resolve()
      .then(async () => {
        while (true) {
          const signal = AbortSignal.timeout(this.timeout);
          signal.addEventListener("abort", () => {
            stream?.abort(new TimeoutError("ping timeout"));
          });

          const buf = await bytes.read(PING_LENGTH, {
            signal,
          });
          await bytes.write(buf, {
            signal,
          });
        }
      })
      .catch((err) => {
        this.log.error(
          "incoming ping from %p failed with error",
          data.connection.remotePeer,
          err
        );
        stream?.abort(err);
      })
      .finally(() => {
        const ms = Date.now() - start;
        this.log(
          "incoming ping from %p complete in %dms",
          data.connection.remotePeer,
          ms
        );
      });
  }

  /**
   * Ping a given peer and wait for its response, getting the operation latency.
   */
  async ping(
    peer: PeerId | Multiaddr | Multiaddr[],
    options: AbortOptions = {}
  ): Promise<number> {
    this.log("pinging %p", peer);
    let stream: Stream | undefined;
    let connection: Connection | undefined;
    try {
      const start = Date.now();
      const data = randomBytes(PING_LENGTH);
      connection = await this.components.connectionManager.openConnection(
        peer,
        options
      );
      if (connection == null) {
        throw new Error("connection is null");
      }

      if (options.signal == null) {
        const signal = AbortSignal.timeout(this.timeout);

        options = {
          ...options,
          signal,
        };
      }

      stream = await connection.newStream(this.protocol, {
        ...options,
        runOnLimitedConnection: this.runOnLimitedConnection,
      });

      const bytes = byteStream(stream);

      const [, result] = await Promise.all([
        bytes.write(data, options),
        bytes.read(PING_LENGTH, options),
      ]);

      const ms = Date.now() - start;

      if (!uint8ArrayEquals(data, result.subarray())) {
        throw new ProtocolError(`Received wrong ping ack after ${ms}ms`);
      }

      this.log("ping %p complete in %dms", connection.remotePeer, ms);

      return ms;
    } catch (err: any) {
      this.log.error("error while pinging %p", peer, err);

      stream?.abort(err);

      throw err;
    } finally {
      if (stream != null) {
        await stream.close(options);
      }
    }
  }
}