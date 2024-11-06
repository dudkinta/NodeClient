import { EventEmitter } from "events";
import { createLibp2p, Libp2p } from "libp2p";
import type { Connection, PeerId } from "@libp2p/interface";
import { DialError } from "@libp2p/interface";
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

  private async createNode(): Promise<Libp2p> {
    const node = await createLibp2p({
      start: false,
      addresses: {
        listen: [
          "/ip4/0.0.0.0/tcp/0/ws", // IPv4 TCP, случайный порт
          "/ip6/::/tcp/0/ws", // IPv6 TCP, случайный порт
          "/p2p-circuit", // Relay
          "/webrtc", // WebRTC
        ],
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
  }

  private registerProtocols(): void {
    if (!this.node) {
      throw new Error("Node is not initialized for protocol registration");
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
              break; // Конец потока
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
              await stream.close(); // Закрытие потока
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
            await stream.close(); // Закрытие потока
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
              await stream.close(); // Закрытие потока
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
              await stream.close(); // Закрытие потока
            } catch (closeErr) {
              console.error(`Error closing PEER_LIST stream: ${closeErr}`);
            }
          }
        }
      }
    );
  }

  async pingByAddress(peerAddress: string): Promise<number | undefined> {
    if (!this.node) {
      return undefined;
    }
    try {
      const addr = multiaddr(peerAddress);
      const ping = this.node.services.ping as PingService;
      return await ping.ping(addr);
    } catch (error) {
      return undefined;
    }
  }

  async connectTo(ma: Multiaddr): Promise<void> {
    const signal = AbortSignal.timeout(5000);
    try {
      if (!this.node) {
        console.error("Error on connectTo. Node is not initialized");
        return;
      }
      await this.node.dial(ma, { signal }).catch((error) => {
        console.error(`Error during dial: ${error}`);
      });
    } catch (error: unknown) {
      if (error instanceof DialError) {
        console.error(`Connection Error: ${error.message}`);
      } else if (error instanceof Error) {
        console.error(`General Error: ${error.message}`);
      } else {
        console.error("Unexpected error", error);
      }
    }
  }

  async disconnectFromMA(ma: Multiaddr): Promise<void> {
    if (!this.node) {
      return;
    }
    const signal = AbortSignal.timeout(5000);
    try {
      return await this.node.hangUp(ma, { signal }).catch((error) => {
        console.error(`Error during disconnectFromMA: ${error}`);
      });
    } catch (err) {
      console.error(
        `Error on disconnectFrom. PeerId: ${ma.toString()}. Error: ${err}`
      );
      return;
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
      // Создание нового потока
      stream = await conn.newStream(protocol).catch((error) => {
        throw new Error(`Error during newStream: ${error}`);
      });

      // Работа с потоком через pipe
      const result = await pipe(stream, async (source) => {
        let output = "";
        for await (const buf of source) {
          output += toString(buf.subarray());
        }
        askResult = output;
      }).catch((error) => {
        throw new Error(`Error during pipe: ${error}`);
      });

      return askResult;
    } catch (err) {
      // Логирование ошибки
      console.error(
        `Error on askToConnection. PeerId: ${conn.remotePeer.toString()}. Protocol: ${protocol}. Error: ${err}`
      );
    } finally {
      // Гарантированное закрытие потока
      if (stream && stream.close) {
        try {
          await stream.close().catch((err: any) => {
            throw new Error(`Error during close stream: ${err}`);
          });
        } catch (closeErr) {
          console.error(
            `Error closing stream. PeerId: ${conn.remotePeer.toString()}. Error: ${closeErr}`
          );
          return askResult;
        }
      }
      return askResult;
    }
  }

  async startNode(): Promise<void> {
    try {
      this.node = await this.createNode();
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
    } catch (err: any) {
      throw new Error(`Error on start client node - ${err}`);
    }
  }
}
