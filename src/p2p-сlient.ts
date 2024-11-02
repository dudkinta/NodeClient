import { createLibp2p } from "libp2p";
import { ping } from "@libp2p/ping";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { tcp } from "@libp2p/tcp";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { kadDHT, removePrivateAddressesMapper } from "@libp2p/kad-dht";
import { identify, identifyPush } from "@libp2p/identify";
import { multiaddr } from "@multiformats/multiaddr";
import { protocolGrouper } from "@tgbc/protocol-grouper";
import { byteStream } from "it-byte-stream";
import { toString } from "uint8arrays";
//import { pipe } from 'it-pipe';
//const packageJson = await import('../package.json', {
//  assert: { type: 'json' },
//});
//import { PeerInfo } from './models/peerInfo.js';

export class P2PClient {
  chatPeers: Set<string> = new Set();
  #node: any = null;
  #localPeer: any = null;
  #multiADDRS: any = null;
  #relayPeer: any = null;
  #CHAT_PROTOCOL: string = "/chat/1.0.0";

  constructor(rAdress: string, rPort: number, rPeer: string) {
    this.#multiADDRS = multiaddr(`/ip4/${rAdress}/tcp/${rPort}/p2p/${rPeer}`);
  }

  async #createNode(): Promise<any> {
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
          protocol: "/ipfs/kad/1.0.0",
          peerInfoMapper: removePrivateAddressesMapper,
        }),
        identify: identify(),
        identifyPush: identifyPush(),
        ping: ping(),
        protocolGrouper: protocolGrouper(),
      },
      connectionManager: {
        maxConnections: 100,
      },
    });
    return node;
  }

  async #connectToMA(ma: any): Promise<any> {
    console.log(`Dialing '${ma}'`);
    const signal = AbortSignal.timeout(5000);
    try {
      const connection = await this.#node.dial(ma, { signal });
      return connection.remotePeer;
    } catch (err: any) {
      if (signal.aborted) {
        console.log(`Timed out connecting to '${ma}'`);
      } else {
        console.log(`Connecting to '${ma}' failed - ${err.message}`);
      }
    }
  }

  async #getMultiaddrrs(peerId: any): Promise<void> {
    try {
      // Используем DHT для поиска адресов по PeerId
      const peerInfo = await this.#node.contentRouting.findPeer(peerId);

      if (peerInfo && peerInfo.multiaddrs.length > 0) {
        // Используем первый найденный многоадрес для подключения
        const connection = await this.#node.dial(peerInfo.multiaddrs[0]);
        console.log(`Подключен к пир с PeerId ${peerId.toString()}`);
      } else {
        console.log(
          `Не удалось найти многоадрес для PeerId ${peerId.toString()}`
        );
      }
    } catch (err: any) {
      console.error(`Ошибка при поиске пира в DHT: ${err.message}`);
    }
  }

  async startNode(): Promise<void> {
    this.#node = await this.#createNode();
    this.#localPeer = this.#node.peerId;
    console.log("Local peer ID:", this.#localPeer.toString());

    this.#node.addEventListener("connection:open", (event: any) => {
      const connection = event.detail;
      if (connection) {
        const peerId = connection.remotePeer;
        if (peerId) {
          console.log(
            `[${new Date().toISOString()}] EVENT: Connection open to peer:', ${peerId.toString()}`
          );

          //this.#addConnection(peerId, connection);

          console.log(
            `[${new Date().toISOString()}] EVENT: Connection opened to peer:', ${peerId}`
          );
        }
      }
    });
    this.#node.addEventListener("protocolGrouper:add", (event: any) => {
      const { peerId, protocol } = event.detail;
      if (protocol === this.#CHAT_PROTOCOL) {
        console.log(
          `[${new Date().toISOString()}] EVENT: protocolGrouper add protocol: ${protocol} ${peerId}`
        );
        const chatPeers = this.#node.services.protocolGrouper.getPeers(
          this.#CHAT_PROTOCOL
        );
        chatPeers.forEach((peer: any) => this.chatPeers.add(peer));
        /*chatPeers.map((peer) => {
          this.#node.peerStore.get(peer).then(peerInfo => {
            console.log(`Peer info:`, peerInfo);
          }).catch(err => {
            console.error(`Ошибка получения информации о пире ${peer.toString()}:`, err);
          });
        });*/
      }
    });
    this.#node.addEventListener("peer:connect", (event: any) => {
      const peerId = event.detail;
      //this.#addPeerId(peerId);
      console.log(
        `[${new Date().toISOString()}] EVENT: Connected to peer:', ${peerId.toString()}`
      );
    });
    this.#node.addEventListener("peer:disconnect", (event: any) => {
      const peerId = event.detail;
      //this.#disconnectPeer(peerId);
      console.log(
        `[${new Date().toISOString()}] EVENT: Disconnected peer:', ${peerId.toString()}`
      );
    });
    this.#node.addEventListener("error", (err: any) => {
      console.error("Libp2p node error:", err);
    });

    this.#node.handle(
      this.#CHAT_PROTOCOL,
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

    try {
      await this.#node.start();
      //console.log(this.#node.peerStore);

      /*const addrs = this.#node.getMultiaddrs();
      if (addrs.length === 0) {
        console.warn(
          'No addresses are being returned by node.getMultiaddrs().',
        );
      } else {
        console.info(addrs.map((ma) => ma.toString()).join('\n'));
      }*/
      this.#relayPeer = await this.#connectToMA(this.#multiADDRS);
      const peerData = await this.#node.peerStore.get(this.#localPeer);
      if (peerData.protocols) {
        console.log("Поддерживаемые протоколы:", peerData.protocols);
      } else {
        console.log("Информация о протоколах не найдена.");
      }
      console.log("Relay peer ID:", this.#relayPeer.toString());
    } catch (err: any) {
      throw new Error(`Error on start client node - ${err.message}`);
    }
  }

  /*connectToPeer(peer) {
    this.peers.push(peer);
  }

  broadcast(data) {
    this.peers.forEach((peer) => {
      peer.send(data);
    });
  }*/
}
//export default P2PClient;
