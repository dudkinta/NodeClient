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
    try {
      await this.client.startNode();
      this.localPeer = this.client.localPeer;
      if (!this.localPeer) {
        console.error("Local peer not found");
        return;
      }

      this.client.on("connection:open", (event: any) => {
        try {
          const conn = event;
          const peerId = event.remotePeer;
          if (!peerId) return;
          if (peerId.toString() === this.localPeer) return;
          if (conn.status !== "open") return;

          this.getNode(peerId.toString(), peerId, conn);
        } catch (error) {
          console.error("Error in connection:open event handler", error);
        }
      });

      this.client.on("updateProtocols", (event) => {
        try {
          const { protocols, peerId } = event;
          if (!peerId) return;
          if (peerId.toString() === this.localPeer) return;

          const node = this.getNode(peerId.toString(), peerId, undefined);
          if (protocols && node) {
            protocols.forEach((protocol: string) => {
              if (!node.protocols.has(protocol)) {
                node.protocols.add(protocol);
              }
            });
          }
        } catch (error) {
          console.error("Error in updateProtocols event handler", error);
        }
      });

      await this.nodeStorage.start(this.localPeer.toString()).catch((error) => {
        console.error("Error starting nodeStorage", error);
      });
    } catch (error) {
      console.error("Error in startAsync", error);
    }
  }

  private getNode(
    peer: string,
    peerId: PeerId | undefined,
    connection: Connection | undefined
  ): Node | undefined {
    try {
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
    } catch (error) {
      console.error("Error in getNode", error);
      return undefined;
    }
  }

  private async RequestConnect(addrr: string): Promise<Connection | undefined> {
    try {
      const ma = multiaddr(addrr);
      const conn = await this.client.connectTo(ma).catch((error) => {
        console.error("Error in promise RequestConnect", error);
        return undefined;
      });
      return conn;
    } catch (error) {
      console.error("Error in RequestConnect", error);
      return undefined;
    }
  }

  private async RequestDisconnect(addrr: string): Promise<void> {
    try {
      const ma = multiaddr(addrr);
      await this.client.disconnectFromMA(ma).catch((error) => {
        console.error("Error in promise RequestDisconnect", error);
      });
    } catch (error) {
      console.error("Error in RequestDisconnect", error);
    }
  }

  private async RequestRoles(node: Node): Promise<string[] | undefined> {
    if (!node.isConnect()) return undefined;
    try {
      if (node.protocols.has(this.config.protocols.ROLE)) {
        const connection = node.getOpenedConnection();
        if (!connection) return undefined;

        const roleList = await this.client
          .askToConnection(connection, this.config.protocols.ROLE)
          .catch((error) => {
            console.error("Error in promise RequestRoles", error);
            return undefined;
          });
        if (!roleList || roleList.length === 0) return undefined;

        try {
          return JSON.parse(roleList);
        } catch (parseError) {
          console.error("Error parsing roleList JSON", parseError);
          return undefined;
        }
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
        const connection = node.getOpenedConnection();
        if (!connection) return undefined;

        const addrrList = await this.client
          .askToConnection(connection, this.config.protocols.MULTIADDRES)
          .catch((error) => {
            console.error("Error in promise RequestMultiaddrrs", error);
            return undefined;
          });
        if (!addrrList || addrrList.length === 0) return undefined;

        try {
          return JSON.parse(addrrList);
        } catch (parseError) {
          console.error("Error parsing addrrList JSON", parseError);
          return undefined;
        }
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
      const connection = node.getOpenedConnection();
      if (!connection) return undefined;

      const peerList = await this.client
        .askToConnection(connection, this.config.protocols.PEER_LIST)
        .catch((error) => {
          console.error("Error in promise RequestConnectedPeers", error);
          return undefined;
        });
      if (!peerList || peerList.length === 0 || peerList === `''`)
        return undefined;

      try {
        return JSON.parse(peerList);
      } catch (parseError) {
        console.error("Error parsing peerList JSON", parseError);
        return undefined;
      }
    } catch (error) {
      console.error("Error in RequestConnectedPeers", error);
      return undefined;
    }
  }

  private async RequestPing(addrr: string): Promise<number | undefined> {
    try {
      //await this.lockerPing.acquire();
      try {
        return await this.client.pingByAddress(addrr).catch((error) => {
          console.error("Error in promise RequestPing", error);
          return undefined;
        });
      } finally {
        //this.lockerPing.release();
      }
    } catch (error) {
      console.error("Error in RequestPing", error);
      return undefined;
    }
  }
}
