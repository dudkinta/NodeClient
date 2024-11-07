import { EventEmitter } from "events";
import { createLibp2p, Libp2p } from "libp2p";
import type { Connection, PeerId } from "@libp2p/interface";
import { ping, PingService } from "@libp2p/ping";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { webRTC } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { kadDHT, removePrivateAddressesMapper } from "@libp2p/kad-dht";
import { identify, identifyPush } from "@libp2p/identify";
import { Multiaddr, multiaddr } from "@multiformats/multiaddr";
import { byteStream } from "it-byte-stream";
import { toString, fromString } from "uint8arrays";
import { pipe } from "it-pipe";
import ConfigLoader from "./helpers/config-loader.js";
import { isDirect } from "./helpers/check-ip.js";

export interface ConnectionOpenEvent {
  peerId: PeerId;
  conn: Connection;
}

export class P2PClient extends EventEmitter {
  private node: Libp2p | undefined;
  private config: any;
  localPeer: string | undefined;
  constructor() {
    super();
    this.config = ConfigLoader.getInstance().getConfig();
  }

  private async createNode(): Promise<Libp2p | undefined> {
    try {
      const port = this.config.port ?? 0;
      let listenAddrs: string[] = this.config.listen ?? ["/ip4/0.0.0.0/tcp/"];
      listenAddrs = listenAddrs.map((addr: string) => `${addr}${port}/ws`);
      listenAddrs.push("/p2p-circuit");
      listenAddrs.push("/webrtc");
      const node = await createLibp2p({
        start: false,
        addresses: {
          listen: listenAddrs,
        },
        transports: [
          webSockets({
            filter: filters.all,
          }),
          webRTC(),
          circuitRelayTransport(),
        ],
        connectionGater: {
          denyDialMultiaddr: () => {
            return false;
          },
        },
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: {
          aminoDHT: kadDHT({
            clientMode: true,
            protocol: "/ipfs/kad/1.0.0",
            peerInfoMapper: removePrivateAddressesMapper,
          }),
          identify: identify(),
          identifyPush: identifyPush(),
          ping: ping(),
        },
        connectionManager: {
          maxConnections: 20,
        },
      });
      return node;
    } catch (error) {
      console.error(`Error during createLibp2p: ${error}`);
      return undefined;
    }
  }

  private registerProtocols(): void {
    if (!this.node) {
      console.error("Node is not initialized for protocol registration");
      return;
    }

    this.node.handle(
      this.config.protocols.CHAT,
      async ({ stream, connection }: any) => {
        const peerId = connection.remotePeer;
        console.log(`Received message from peer: ${peerId.toString()}`);

        const chatStream = byteStream(stream);
        try {
          while (true) {
            const buf = await chatStream.read();

            if (buf == null) {
              break; // End of stream
            }
            console.log(
              `Received message string '${toString(buf.subarray())}'`
            );
          }
        } catch (err) {
          console.error(`Error reading from chat stream: ${err}`);
        } finally {
          if (stream && stream.close) {
            try {
              await stream.close();
            } catch (closeErr) {
              console.error(`Error closing chat stream: ${closeErr}`);
            }
          }
        }
      }
    );

    this.node.handle(this.config.protocols.ROLE, async ({ stream }: any) => {
      const ROLES = [this.config.roles.NODE];
      try {
        await pipe([fromString(JSON.stringify(ROLES))], stream);
      } catch (err) {
        console.error(`Error writing to ROLE stream: ${err}`);
      } finally {
        if (stream && stream.close) {
          try {
            await stream.close();
          } catch (closeErr) {
            console.error(`Error closing ROLE stream: ${closeErr}`);
          }
        }
      }
    });

    this.node.handle(
      this.config.protocols.MULTIADDRES,
      async ({ stream }: any) => {
        if (!this.node) {
          return;
        }
        const multiaddrs = this.node
          .getMultiaddrs()
          .map((ma: Multiaddr) => ma.toString());
        try {
          await pipe([fromString(JSON.stringify(multiaddrs))], stream);
        } catch (err) {
          console.error(`Error writing to MULTIADDRES stream: ${err}`);
        } finally {
          if (stream && stream.close) {
            try {
              await stream.close();
            } catch (closeErr) {
              console.error(`Error closing MULTIADDRES stream: ${closeErr}`);
            }
          }
        }
      }
    );

    this.node.handle(
      this.config.protocols.PEER_LIST,
      async ({ stream }: any) => {
        if (!this.node) {
          return;
        }
        const connections = this.node.getConnections();
        const peerData = connections.map((conn) => ({
          peerId: conn.remotePeer.toString(),
          address: conn.remoteAddr.toString(),
        }));
        try {
          await pipe([fromString(JSON.stringify(peerData))], stream);
        } catch (err) {
          console.error(`Error writing to PEER_LIST stream: ${err}`);
        } finally {
          if (stream && stream.close) {
            try {
              await stream.close();
            } catch (closeErr) {
              console.error(`Error closing PEER_LIST stream: ${closeErr}`);
            }
          }
        }
      }
    );
  }

  async pingByAddress(peerAddress: string): Promise<number> {
    if (!this.node) {
      return 1000000;
    }
    try {
      const addr = multiaddr(peerAddress);
      const ping = this.node.services.ping as PingService;
      const latency = await ping.ping(addr);
      return latency;
    } catch (error) {
      console.error("Ошибка при пинге:", error);
      return 100000;
    }
  }

  async connectTo(ma: Multiaddr): Promise<Connection | undefined> {
    const signal = AbortSignal.timeout(5000);
    try {
      if (!this.node) {
        return undefined;
      }
      console.log(`\x1b[32mConnecting to DIRECT MA--> ${ma.toString()}\x1b[0m`);
      const conn = await this.node.dial(ma, { signal });
      if (conn) {
        console.log(
          `\x1b[32mConnect to DIRECT MA--> ${conn.remoteAddr.toString()} Status: ${conn.status}\x1b[0m`
        );
      }
      return conn;
    } catch (error) {
      console.error("Error in connectTo");
      console.error(error);
      return undefined;
    }
  }

  async disconnectFromMA(ma: Multiaddr): Promise<void> {
    if (!this.node) {
      return;
    }
    const signal = AbortSignal.timeout(5000);
    try {
      await this.node.hangUp(ma, { signal });
    } catch (error) {
      console.error("Error in disconnectFromMA: ", error);
    }
  }

  async askToConnection(conn: Connection, protocol: string): Promise<string> {
    let stream: any;
    let askResult = "[]";
    try {
      if (!this.node) {
        return askResult;
      }
      if (conn && conn.status !== "open") {
        return askResult;
      }
      // Create new stream
      stream = await conn.newStream(protocol);

      // Work with stream via pipe
      await pipe(stream, async (source) => {
        let output = "";
        try {
          for await (const buf of source) {
            output += toString(buf.subarray());
          }
          askResult = output;
        } catch (error) {
          console.error(`Error during iteration: ${error}`);
        }
        askResult = output;
      });

      return askResult;
    } catch (err) {
      console.error(
        `Error on askToConnection. PeerId: ${conn.remotePeer.toString()}. Protocol: ${protocol}. Error: ${err}`
      );
    } finally {
      // Ensure stream is closed
      if (stream && stream.close) {
        try {
          await stream.close();
        } catch (closeErr) {
          console.error(
            `Error closing stream. PeerId: ${conn.remotePeer.toString()}. Error: ${closeErr}`
          );
        }
      }
      return askResult;
    }
  }

  async startNode(): Promise<void> {
    try {
      this.node = await this.createNode();
      if (!this.node) {
        console.error("Node is not initialized");
        return;
      }
      this.registerProtocols();

      this.localPeer = this.node.peerId.toString();
      this.node.addEventListener("connection:open", (event: any) => {
        this.emit("connection:open", event.detail);
      });
      this.node.addEventListener("connection:close", (event: any) => {
        const conn: Connection = event.detail;
        const peerId: PeerId = conn.remotePeer;
        this.emit("connection:close", { peerId, conn });
      });
      this.node.addEventListener("peer:connect", (event: any) => {
        const peerId = event.detail;
        if (peerId) {
          this.emit("peer:connect", peerId);
        }
      });
      this.node.addEventListener("peer:disconnect", (event: any) => {
        const peerId = event.detail;
        if (peerId) {
          this.emit("peer:disconnect", peerId);
        }
      });
      this.node.addEventListener("peer:update", (event: any) => {
        const protocols = event.detail.peer.protocols;
        const peerId: PeerId = event.detail.peer.id;
        if (protocols && peerId) {
          this.emit("updateProtocols", { peerId, protocols });
        }
      });
      this.node.addEventListener("start", (event: any) => {
        console.log("Libp2p node started");
      });

      await this.node.start();
      console.log(`Libp2p listening on:`);
      this.node.getMultiaddrs().forEach((ma) => {
        console.log(`${ma.toString()}`);
      });
    } catch (err: any) {
      console.error(`Error on start client node - ${err}`);
    }
  }
}
