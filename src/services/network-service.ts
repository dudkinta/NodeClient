import { EventEmitter } from "events";
import config from "./../config.json" assert { type: "json" };
import { P2PClient, ConnectionOpenEvent } from "./../p2p-сlient.js";
import { multiaddr } from "@multiformats/multiaddr";
import { Connection } from "@libp2p/interface";
import { Node } from "./../models/node.js";
import Queue from "queue";
import { NodeStrategy } from "./node-strategy.js";

export class NetworkService extends EventEmitter {
  private client: P2PClient;
  private nodes: Map<string, Node>;
  private localPeer: string | undefined;
  private taskQueue: Queue;
  private nodeStrategy: NodeStrategy;
  constructor(p2pClient: P2PClient) {
    super();
    this.client = p2pClient;
    this.nodes = new Map<string, Node>();
    this.taskQueue = new Queue();
    this.taskQueue.autostart = true;
    this.taskQueue.concurrency = 1;
    this.nodeStrategy = new NodeStrategy(
      this.client,
      this.Connect,
      this.RequestRoles,
      this.RequestMultiaddrrs,
      this.RequestConnectedPeers
    );
  }

  async startAsync(): Promise<void> {
    await this.client.startNode();
    this.localPeer = this.client.localPeer;

    this.client.on("connection:open", (event: ConnectionOpenEvent) => {
      const { peerId, conn } = event;
      if (peerId.toString() === this.localPeer) return;

      const node = this.getNode(peerId.toString());
      node.connection = conn;
      node.peerId = peerId;
    });
    this.client.on("connection:close", (event) => {
      const { peerId } = event;
      if (peerId.toString() === this.localPeer) return;

      const node = this.getNode(peerId.toString());
      node.isConnect = false;
      node.connection = undefined;
      node.peerId = undefined;
    });
    this.client.on("updateProtocols", (event) => {
      const { protocols, peerId } = event;
      if (peerId.toString() === this.localPeer) return;

      let node = this.getNode(peerId.toString());
      if (protocols) {
        protocols.forEach((protocol: string) => {
          if (node.protocols.has(protocol)) return;
          node.protocols.add(protocol);
        });
      }
    });

    this.nodeStrategy.on("foundPeer", async (event) => {
      const { peer, addrr } = event;
      if (peer == this.localPeer) return;
      const node = this.getNode(peer);
      if (node.isConnect) return;

      node.addresses.add(addrr);
      console.log(`foundPeer->connect to address ${addrr}`);
      const conn = await this.Connect(this.client, addrr);
      if (conn) {
        console.log(`foundPeer->connected to ${conn.remotePeer.toString()}`);
        node.connection = conn;
        node.peerId = conn.remotePeer;
        node.isConnect = true;
        this.nodeStrategy.execute(node);
      }
    });
    this.nodeStrategy.on("removePeer", async (event) => {
      const { peer } = event;
      console.log(`removePeer->disconnect from ${peer.toString()}`);
      await this.client.disconnectFrom(peer);
    });

    const relay = config.relay[0];
    const address = `/ip4/${relay.ADDRESS}/tcp/${relay.PORT}/ws/p2p/${relay.PEER}`;
    const conn = await this.Connect(this.client, address);
    if (conn) {
      const node = this.getNode(conn.remotePeer.toString());
      node.connection = conn;
      node.peerId = conn.remotePeer;
      node.isConnect = true;
      this.nodeStrategy.execute(node);
    }
  }

  private getNode(peerId: string): Node {
    let node = this.nodes.get(peerId);
    if (!node) {
      node = new Node(this.nodeStrategy, undefined, undefined);
      this.nodes.set(peerId, node);
    }
    return node;
  }
  private async Connect(
    client: P2PClient,
    addrr: string
  ): Promise<Connection | undefined> {
    const ma = multiaddr(addrr);
    const conn = await client.connectTo(ma);
    if (conn) {
      return conn;
    }
    return undefined;
  }

  private async RequestRoles(
    client: P2PClient,
    node: Node
  ): Promise<string[] | undefined> {
    if (!node.connection) return undefined;
    if (!node.isConnect) return undefined;
    try {
      if (node.protocols.has(config.protocols.ROLE)) {
        const roleList = await client.askToConnection(
          node.connection,
          config.protocols.ROLE
        );
        return JSON.parse(roleList);
      } else {
        return undefined;
      }
    } catch (error) {
      console.error("Error in RequestRoles", error);
      return undefined;
    }
  }

  private async RequestMultiaddrrs(
    client: P2PClient,
    node: Node
  ): Promise<string[] | undefined> {
    if (!node.connection) return undefined;
    if (!node.isConnect) return undefined;
    try {
      if (node.protocols.has(config.protocols.MULTIADDRES)) {
        const addrrList = await client.askToConnection(
          node.connection,
          config.protocols.MULTIADDRES
        );
        return JSON.parse(addrrList);
      } else {
        return undefined;
      }
    } catch (error) {
      console.error("Error in RequestMultiaddrrs", error);
      return undefined;
    }
  }

  private async RequestConnectedPeers(
    client: P2PClient,
    node: Node
  ): Promise<any | undefined> {
    if (!node.connection) return undefined;
    if (!node.isConnect) return undefined;
    try {
      const peerList = await client.askToConnection(
        node.connection,
        config.protocols.PEER_LIST
      );
      return JSON.parse(peerList);
    } catch (error) {
      console.error("Error in RequestConnectedPeers", error);
      return undefined;
    }
  }
}
