import { EventEmitter } from "events";
import config from "./../config.json" assert { type: "json" };
import { P2PClient, ConnectionOpenEvent } from "./../p2p-сlient.js";
import { multiaddr } from "@multiformats/multiaddr";
import { Node } from "./../models/node.js";
import { isLocal } from "../helpers/check-ip.js";

export class NetworkService extends EventEmitter {
  private client: P2PClient;
  private nodes: Map<string, Node>;
  private localPeer: string | undefined;

  constructor(p2pClient: P2PClient) {
    super();
    this.client = p2pClient;
    this.nodes = new Map<string, Node>();
  }

  async startAsync(): Promise<void> {
    await this.client.startNode();
    this.localPeer = this.client.localPeer;

    this.client.on("connection:open", (event: ConnectionOpenEvent) => {
      const { peerId, conn } = event;
      if (peerId.toString() === this.localPeer) return;

      let node = this.nodes.get(peerId.toString());
      if (!node) {
        node = new Node(peerId, conn);
      } else {
        node.peerId = peerId;
        node.connection = conn;
      }
      try {
        this.client
          .askToConnection(conn, config.protocols.ROLE)
          .then((result) => {
            const roleList: string[] = JSON.parse(result);
            roleList.forEach((role) => {
              node.roles.add(role);
            });
          });
      } catch (error) {}
      try {
        this.client
          .askToConnection(conn, config.protocols.PEER_LIST)
          .then((result) => {
            const peerList: string[] = JSON.parse(result);
            peerList.forEach((peer) => {
              node.peers.add(peer);
            });
          });
      } catch (error) {}
      node.isConnect = true;
      this.nodes.set(peerId.toString(), node);
      console.log("New connection:", node);
    });
    this.client.on("protocolGrouper:add", (event) => {
      const { protocol, peerId } = event;
      if (peerId.toString() === this.localPeer) return;

      const node = this.nodes.get(peerId.toString());
      if (node) {
        node.protocols.add(protocol);
      } else {
        const newNode = new Node(peerId);
        newNode.protocols.add(protocol);
        this.nodes.set(peerId.toString(), newNode);
      }
    });
    const relay = config.relay[0];
    const address = `/ip4/${relay.ADDRESS}/tcp/${relay.PORT}/p2p/${relay.PEER}`;
    const ma = multiaddr(address);
    await this.client.connectTo(ma);
    this.startAnalizers();
  }

  private startAnalizers(): void {
    setInterval(() => {
      this.addressedAnalizer();
    }, 60e3);
    setInterval(async () => {
      await this.connectingAnalizer();
    }, 10e3);
  }

  private async discoveryAnalizer(): Promise<void> {}

  private addressedAnalizer(): void {
    this.nodes.forEach((node) => {
      if (!node.peerId) return;

      this.client.getMultiaddrrs(node.peerId!).then((multiaddrs) => {
        if (multiaddrs) {
          let addresses = multiaddrs.map((ma) => ma.toString());
          node.addresses = new Set(addresses);
        }
      });
    });
  }

  private async connectingAnalizer(): Promise<void> {
    const tasks: Promise<void>[] = [];
    const relayCount = Array.from(this.nodes.values()).filter(
      (n) => n.roles.has(config.roles.RELAY) && n.isConnect
    ).length;
    const nodeCount = Array.from(this.nodes.values()).filter(
      (n) => n.roles.has(config.roles.NODE) && n.isConnect
    ).length;

    for (const nodePair of this.nodes) {
      const node = nodePair[1];
      if (!node.peerId) continue;

      tasks.push(
        (async () => {
          if (!node.isConnect) {
            if (
              relayCount === 0 &&
              nodeCount === 0 &&
              node.roles.has(config.roles.RELAY)
            ) {
              await this.tryConnectNode(node);
            } else if (nodeCount < 20 && node.roles.has(config.roles.NODE)) {
              await this.tryConnectNode(node);
            }
          }

          if (node.isConnect && node.protocols.has(config.protocols.PING)) {
            await this.trySendPing(node);
          }
        })()
      );
    }
    await Promise.all(tasks);
  }

  private async tryConnectNode(node: Node): Promise<void> {
    if (node.addresses.size > 0) {
      const multiaddrs = Array.from(node.addresses).map((a) => multiaddr(a));
      const filteredAddrs = multiaddrs.filter((ma) => !isLocal(ma));
      if (filteredAddrs.length > 0) {
        this.client.connectTo(filteredAddrs[0]);
      }
    }
  }

  private async trySendPing(node: Node): Promise<void> {
    if (!node.connection) return;

    try {
      console.log("Send Ping ", node.peerId?.toString());
      const startTime = Date.now();

      this.client
        .askToConnection(node.connection, config.protocols.PING)
        .then((result) => {
          console.log(
            `Ping node ${node.peerId?.toString()} ${result == "PONG" ? "success" : "fail"} (${Date.now() - startTime} ms)`
          );
        });
    } catch (error) {}
  }
}
