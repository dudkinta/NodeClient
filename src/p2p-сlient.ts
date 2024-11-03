import { EventEmitter } from "events";
import { createLibp2p, Libp2p } from "libp2p";
import type { Connection, PeerId, PeerInfo } from "@libp2p/interface";
import { ping } from "@libp2p/ping";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { tcp } from "@libp2p/tcp";
import {
  circuitRelayServer,
  circuitRelayTransport,
} from "@libp2p/circuit-relay-v2";
import { kadDHT, removePrivateAddressesMapper } from "@libp2p/kad-dht";
import { identify, identifyPush } from "@libp2p/identify";
import { Multiaddr } from "@multiformats/multiaddr";
import { protocolGrouper } from "@tgbc/protocol-grouper";
import { byteStream } from "it-byte-stream";
import { toString, fromString } from "uint8arrays";
import { pipe } from "it-pipe";
import config from "./config.json" assert { type: "json" };

export interface ConnectionOpenEvent {
  peerId: PeerId;
  conn: Connection;
}

export class P2PClient extends EventEmitter {
  private node: any = null;
  localPeer: string | undefined;
  constructor() {
    super();
  }

  private async createNode(): Promise<Libp2p> {
    const node = await createLibp2p({
      start: true,
      addresses: {
        listen: [
          "/ip4/0.0.0.0/tcp/0", // IPv4 TCP, случайный порт
          "/ip6/::/tcp/0", // IPv6 TCP, случайный порт
          "/p2p-circuit", // Relay
        ],
      },
      transports: [tcp(), circuitRelayTransport()],

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
        protocolGrouper: protocolGrouper(),
      },
      connectionManager: {
        maxConnections: 20,
      },
    });
    return node;
  }

  async connectTo(ma: Multiaddr): Promise<Connection | undefined> {
    const signal = AbortSignal.timeout(5000);
    try {
      return await this.node.dial(ma, signal);
    } catch (err) {
      console.error(
        `Error on connectTo. Multiaddr: ${ma.toString()}. Error: ${err}`
      );
      return undefined;
    }
  }

  async askToPeer(ma: Multiaddr, protocol: string): Promise<string> {
    let stream: any;
    try {
      // Создание нового потока с таймаутом
      const signal = AbortSignal.timeout(5000);
      stream = await this.node.dialProtocol(ma, protocol, signal);

      // Используем pipe для обработки потока и гарантируем его закрытие
      const result = await pipe(
        stream, // Входной поток
        async function (source) {
          let output = "";
          for await (const buf of source) {
            output += toString(buf.subarray());
          }
          return output;
        },
        async function (result) {
          if (stream && stream.close) {
            try {
              await stream.close(); // Закрытие потока после использования
            } catch (err) {
              console.error(
                `Error closing stream. Multiaddr: ${ma.toString()}. Error: ${err}`
              );
            }
          }
          return result;
        }
      );

      return result;
    } catch (err) {
      console.error(
        `Error on askToPeer. Multiaddr: ${ma.toString()}. Protocol: ${protocol}. Error: ${err}`
      );
      if (stream && stream.close) {
        try {
          await stream.close(); // Закрытие потока в случае ошибки
        } catch (closeErr) {
          console.error(
            `Error closing stream. Multiaddr: ${ma.toString()}. Error: ${closeErr}`
          );
        }
      }
      return "";
    }
  }

  async askToConnection(conn: Connection, protocol: string): Promise<string> {
    let stream: any;
    try {
      // Создание нового потока
      stream = await conn.newStream(protocol);

      // Работа с потоком через pipe
      const result = await pipe(stream, async (source) => {
        let output = "";
        for await (const buf of source) {
          output += toString(buf.subarray());
        }
        return output;
      });

      return result;
    } catch (err) {
      // Логирование ошибки
      console.error(
        `Error on askToConnection. PeerId: ${conn.remotePeer.toString()}. Protocol: ${protocol}. Error: ${err}`
      );
      return "";
    } finally {
      // Гарантированное закрытие потока
      if (stream && stream.close) {
        try {
          await stream.close(); // Закрытие потока
        } catch (closeErr) {
          console.error(
            `Error closing stream. PeerId: ${conn.remotePeer.toString()}. Error: ${closeErr}`
          );
        }
      }
    }
  }

  async getMultiaddrrs(peerId: PeerId): Promise<Multiaddr[] | undefined> {
    if (!this.node.peerRouting) {
      console.error("PeerRouting not found");
      return undefined;
    }
    const peerInfo = await this.node.peerRouting.findPeer(peerId);
    if (peerInfo) {
      return peerInfo.multiaddrs;
    }
    return undefined;
  }

  async startNode(): Promise<void> {
    this.node = await this.createNode();
    const localPeer = this.node.peerId;
    console.log("Local peer ID:", localPeer.toString());
    this.localPeer = localPeer.toString();
    this.node.addEventListener("connection:open", (event: any) => {
      const conn: Connection = event.detail;
      const peerId: PeerId = conn.remotePeer;
      this.emit("connection:open", { peerId, conn });
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
    this.node.addEventListener("protocolGrouper:add", (event: any) => {
      const { protocol, peerId } = event.detail;
      this.emit("protocolGrouper:add", { protocol, peerId });
    });
    this.node.addEventListener("error", (err: any) => {
      console.error("Libp2p node error:", err);
    });

    this.node.handle(
      config.protocols.CHAT,
      async ({ stream, connection }: any) => {
        const peerId = connection.remotePeer;
        console.log(`Received message from peer: ${peerId.toString()}`);

        const chatStream = byteStream(stream);
        while (true) {
          const buf = await chatStream.read();
          console.log(`Received message string'${toString(buf.subarray())}'`);
        }
      }
    );
    this.node.handle(config.protocols.ROLE, async ({ stream }: any) => {
      const ROLES = [config.roles.NODE];
      await pipe([fromString(JSON.stringify(ROLES))], stream);
    });
    this.node.handle(config.protocols.PING, async ({ stream }: any) => {
      await pipe([fromString("PONG")], stream);
    });
    this.node.handle(config.protocols.MULTIADDRES, async ({ stream }: any) => {
      const multiaddrs = this.node
        .getMultiaddrs()
        .map((ma: Multiaddr) => ma.toString());
      await pipe([fromString(JSON.stringify(multiaddrs))], stream);
    });
    this.node.handle(config.protocols.PEER_LIST, async ({ stream }: any) => {
      const connections = this.node.getConnections();
      const peerIds = connections.map((conn: any) =>
        conn.remotePeer.toString()
      );

      await pipe([fromString(JSON.stringify(peerIds))], stream);
    });
    try {
      await this.node.start();
    } catch (err: any) {
      throw new Error(`Error on start client node - ${err}`);
    }
  }
  async findPeer(peer: PeerId): Promise<PeerInfo | undefined> {
    try {
      return await this.node.peerRouting.findPeer(peer);
    } catch (err) {
      return undefined;
    }
  }
  isPeerConnected(peerId: PeerId): boolean {
    const connections = this.node.getConnections();
    return connections.some((conn: Connection) =>
      conn.remotePeer.equals(peerId)
    );
  }
}
