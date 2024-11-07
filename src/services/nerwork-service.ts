import { EventEmitter } from "events";
import ConfigLoader from "../helpers/config-loader.js";
import { P2PClient } from "../p2p-сlient.js";
import { multiaddr } from "@multiformats/multiaddr";
import { Connection, PeerId } from "@libp2p/interface";
import { Node } from "../models/node.js";
import { Lock } from "../helpers/lock.js";
import { NodeStorage } from "./node-storage.js";

export class NetworkService extends EventEmitter {
  private client: P2PClient;
  private nodeStorage: NodeStorage;
  private localPeer: string | undefined;
  private lockerPing: Lock;
  private config = ConfigLoader.getInstance().getConfig();
  constructor(p2pClient: P2PClient) {
    super();
    this.client = p2pClient;
    this.nodeStorage = new NodeStorage(
      this.RequestConnect.bind(this),
      this.RequestDisconnect.bind(this),
      this.RequestRoles.bind(this),
      this.RequestMultiaddrrs.bind(this),
      this.RequestConnectedPeers.bind(this),
      this.RequestPing.bind(this)
    );
    this.lockerPing = new Lock();
  }

  async startAsync(): Promise<void> {
    await this.client.startNode();
    this.localPeer = this.client.localPeer;
    if (!this.localPeer) {
      throw new Error("Local peer not found");
    }

    this.client.on("connection:open", (event: any) => {
      const conn = event;
      const peerId = event.remotePeer;
      if (peerId.toString() === this.localPeer) return;
      if (conn.status != "open") return;
      if (!peerId) return;

      this.getNode(peerId.toString(), peerId, conn);
    });

    this.client.on("updateProtocols", (event) => {
      const { protocols, peerId } = event;
      if (peerId.toString() === this.localPeer) return;

      let node = this.getNode(peerId.toString(), peerId, undefined);
      if (protocols) {
        protocols.forEach((protocol: string) => {
          if (node.protocols.has(protocol)) return;
          node.protocols.add(protocol);
        });
      }
    });

    await this.nodeStorage.start(this.localPeer.toString()).catch((error) => {
      console.error("Error in startAsync", error);
    });
  }

  private getNode(
    peer: string,
    peerId: PeerId | undefined,
    connection: Connection | undefined
  ): Node {
    let node = this.nodeStorage.get(peer);
    if (!node) {
      node = new Node(peerId, connection);
      this.nodeStorage.set(peer, node);
    } else {
      if (peerId) {
        node.peerId = peerId;
      }
      if (connection) {
        node.connections.add(connection);
      }
    }
    return node;
  }

  private async RequestConnect(addrr: string): Promise<Connection | undefined> {
    const ma = multiaddr(addrr);
    const conn = await this.client.connectTo(ma).catch((error) => {
      console.error("Error in promise RequestConnect", error);
      return undefined;
    });
    return conn;
  }

  private async RequestDisconnect(addrr: string): Promise<void> {
    const ma = multiaddr(addrr);
    await this.client.disconnectFromMA(ma).catch((error) => {
      console.error("Error in promise RequestDisconnect", error);
    });
  }
  private async RequestRoles(node: Node): Promise<string[] | undefined> {
    if (!node.isConnect()) return undefined;
    try {
      if (node.protocols.has(this.config.protocols.ROLE)) {
        const connecton = node.getOpenedConnection();
        if (!connecton) return undefined;

        const roleList = await this.client
          .askToConnection(connecton, this.config.protocols.ROLE)
          .catch((error) => {
            console.error("Error in promise RequestRoles", error);
            return undefined;
          });
        if (!roleList || roleList.length === 0) return undefined;
        return JSON.parse(roleList);
      } else {
        return undefined;
      }
    } catch (error) {
      console.error("Error in RequestRoles", error);
      return undefined;
    }
  }

  private async RequestMultiaddrrs(node: Node): Promise<string[] | undefined> {
    if (!node.isConnect()) return undefined;
    try {
      if (node.protocols.has(this.config.protocols.MULTIADDRES)) {
        const connecton = node.getOpenedConnection();
        if (!connecton) return undefined;

        const addrrList = await this.client
          .askToConnection(connecton, this.config.protocols.MULTIADDRES)
          .catch((error) => {
            console.error("Error in promise RequestMultiaddrrs", error);
            return undefined;
          });
        if (!addrrList || addrrList.length === 0) return undefined;
        return JSON.parse(addrrList);
      } else {
        return undefined;
      }
    } catch (error) {
      console.error("Error in RequestMultiaddrrs", error);
      return undefined;
    }
  }

  private async RequestConnectedPeers(node: Node): Promise<any | undefined> {
    if (!node.isConnect()) return undefined;
    try {
      const connecton = node.getOpenedConnection();
      if (!connecton) return undefined;

      const peerList = await this.client
        .askToConnection(connecton, this.config.protocols.PEER_LIST)
        .catch((error) => {
          console.error("Error in promise RequestConnectedPeers", error);
          return undefined;
        });
      if (!peerList || peerList.length === 0 || peerList == `''`)
        return undefined;
      return JSON.parse(peerList);
    } catch (error) {
      console.error("Error in RequestConnectedPeers", error);
      return undefined;
    }
  }

  private async RequestPing(addrr: string): Promise<number | undefined> {
    await this.lockerPing.acquire();
    try {
      return await this.client.pingByAddress(addrr).catch((error) => {
        console.error("Error in promise RequestPing", error);
        return undefined;
      });
    } finally {
      this.lockerPing.release();
    }
  }
}
