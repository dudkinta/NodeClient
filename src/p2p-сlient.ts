import { EventEmitter } from "events";
import { createLibp2p, Libp2p } from "libp2p";
import type { Connection, PeerId, PeerInfo } from "@libp2p/interface";
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
import config from "./config.json" assert { type: "json" };

export interface ConnectionOpenEvent {
  peerId: PeerId;
  conn: Connection;
}

export class P2PClient extends EventEmitter {
  private node: Libp2p | undefined;
  localPeer: string | undefined;
  constructor() {
    super();
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

  async pingCandidate(peerAddress: string): Promise<number | undefined> {
    if (!this.node) {
      return undefined;
    }
    try {
      const addr = multiaddr(peerAddress);
      const ping = this.node.services.ping as PingService;
      return await ping.ping(addr);
      //return undefined;
    } catch (error) {
      console.error(`Ошибка при пинге ${peerAddress}:`, error);
      return undefined;
    }
  }

  async connectTo(ma: Multiaddr): Promise<Connection | undefined> {
    const signal = AbortSignal.timeout(5000);
    try {
      if (!this.node) {
        return undefined;
      }
      return await this.node.dial(ma, { signal });
    } catch (err) {
      console.error(
        `Error on connectTo. Multiaddr: ${ma.toString()}. Error: ${err}`
      );
      return undefined;
    }
  }
  async disconnectFrom(peer: PeerId): Promise<void> {
    if (!this.node) {
      return;
    }
    const signal = AbortSignal.timeout(5000);
    try {
      return await this.node.hangUp(peer, { signal });
    } catch (err) {
      console.error(
        `Error on disconnectFrom. PeerId: ${peer.toString()}. Error: ${err}`
      );
      return undefined;
    }
  }
  /*
  async askToPeer(ma: Multiaddr, protocol: string): Promise<string> {
    let stream: any;
    try {
      if (!this.node) {
        return "";
      }
      // Создание нового потока с таймаутом
      const signal = AbortSignal.timeout(5000);
      stream = await this.node.dialProtocol(ma, protocol, { signal });

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
  }*/
  /*
  async askToPeer2(
    ma: Multiaddr,
    protocol: string,
    message: string
  ): Promise<string> {
    let stream: any;
    if (!this.node) {
      return "";
    }
    try {
      // Создание нового потока с таймаутом
      const signal = AbortSignal.timeout(5000);
      stream = await this.node.dialProtocol(ma, protocol, { signal });

      // Отправляем сообщение
      await pipe(
        [fromString(message)], // Сообщение, которое хотим отправить
        stream.sink // Запись в поток
      );

      // Читаем ответ
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
*/
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

  async startNode(): Promise<void> {
    this.node = await this.createNode();
    await this.node.register(config.protocols.ROLE, {
      notifyOnLimitedConnection: false,
    });
    await this.node.register(config.protocols.PEER_LIST, {
      notifyOnLimitedConnection: false,
    });
    await this.node.register(config.protocols.MULTIADDRES, {
      notifyOnLimitedConnection: false,
    });
    await this.node.register(config.protocols.CHAT, {
      notifyOnLimitedConnection: false,
    });
    await this.node.start();
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
    this.node.handle(config.protocols.MULTIADDRES, async ({ stream }: any) => {
      if (!this.node) {
        return;
      }
      const multiaddrs = this.node
        .getMultiaddrs()
        .map((ma: Multiaddr) => ma.toString());
      await pipe([fromString(JSON.stringify(multiaddrs))], stream);
    });
    this.node.handle(config.protocols.PEER_LIST, async ({ stream }: any) => {
      if (!this.node) {
        return;
      }
      const connections = this.node.getConnections();

      const peerData = connections.map((conn) => ({
        peerId: conn.remotePeer.toString(),
        address: conn.remoteAddr.toString(),
      }));

      await pipe([fromString(JSON.stringify(peerData))], stream);
    });
    try {
      await this.node.start();
    } catch (err: any) {
      throw new Error(`Error on start client node - ${err}`);
    }
  }
}
