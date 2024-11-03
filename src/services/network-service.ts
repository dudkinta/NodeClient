import { EventEmitter } from "events";
import { peerIdFromString } from "@libp2p/peer-id";
import config from "./../config.json" assert { type: "json" };
import { P2PClient, ConnectionOpenEvent } from "./../p2p-сlient.js";
import type { Connection } from "@libp2p/interface";
import { multiaddr } from "@multiformats/multiaddr";
import { Node } from "./../models/node.js";
import { isLocal } from "../helpers/check-ip.js";
import Queue from "queue";

export class NetworkService extends EventEmitter {
  private client: P2PClient;
  private nodes: Map<string, Node>;
  private localPeer: string | undefined;
  private taskQueue: Queue;
  constructor(p2pClient: P2PClient) {
    super();
    this.client = p2pClient;
    this.nodes = new Map<string, Node>();
    this.taskQueue = new Queue();
    this.taskQueue.autostart = true;
    this.taskQueue.concurrency = 1;
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

      node.isConnect = true;
      this.nodes.set(peerId.toString(), node);
      console.log("New connection:", node);
    });
    this.client.on("connection:close", (event) => {
      const { peerId } = event;
      if (peerId.toString() === this.localPeer) return;

      const node = this.nodes.get(peerId.toString());
      if (node) {
        node.peerId = peerId;
        node.connection = undefined;
        node.isConnect = false;
        node.peers.clear();
      }
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
      this.addressedAndRolesAnalizer();
    }, 10e3);
    setInterval(async () => {
      this.discoveryAnalizr();
    }, 10e3);
    setInterval(async () => {
      this.connectingAnalizer();
    }, 10e3);
    setInterval(() => {
      this.createEmptyPeers();
    }, 10e3);
  }

  private createEmptyPeers(): void {
    for (const nodePair of this.nodes) {
      const node = nodePair[1];
      if (node.peers.size == 0) continue;

      for (const peerContact of node.peers) {
        if (peerContact[0] === this.localPeer) continue;

        if (!this.nodes.has(peerContact[0])) {
          console.log("Create peer from nodePeers", peerContact[0]);
          let peerId = peerIdFromString(peerContact[0]);
          const node = new Node(peerId);
          node.addresses = new Set();
          node.addresses.add(peerContact[1]);
          this.nodes.set(peerContact[0], node);
          /*this.taskQueue.push(async () => {
            console.log("Find empty peer", peerId);
            const peerInfo = await this.client.findPeer(peerId);
          });*/
        }
      }
    }
  }

  private discoveryAnalizr(): void {
    for (const nodePair of this.nodes) {
      const node = nodePair[1];
      if (!node.peerId || !node.connection) continue;

      this.taskQueue.push(async () => {
        const peerList = await this.client.askToConnection(
          node.connection!,
          config.protocols.PEER_LIST
        );
        const peerInfoList: any[] = JSON.parse(peerList);
        peerInfoList.forEach((peerInfo) => {
          const { peerId, address } = peerInfo;
          if (!node.peers.has(peerId)) {
            if (node.protocols.has(config.protocols.CIRCUIT_HOP)) {
              const relayAddress = node.connection!.remoteAddr.toString();
              const fullAddress = `${relayAddress}/p2p-circuit/p2p/${peerId}`;
              node.peers.set(peerId, fullAddress);
            }
          }
        });
      });
    }
  }

  private addressedAndRolesAnalizer(): void {
    for (const nodePair of this.nodes) {
      const node = nodePair[1];
      if (!node.peerId) {
        continue;
      }

      if (node.isConnect) {
        if (node.roles.size === 0) {
          this.taskQueue.push(async () => {
            const roleList = await this.client.askToConnection(
              node.connection!,
              config.protocols.ROLE
            );
            const roles: string[] = JSON.parse(roleList);
            roles.forEach((role) => {
              if (!node.roles.has(role)) {
                node.roles.add(role);
              }
            });
          });
        }
      } else {
        this.taskQueue.push(async () => {
          if (node.addresses.size > 0) {
            const ma = multiaddr(node.addresses.values().next().value);
            const roleList = await this.client.askToPeer(
              ma,
              config.protocols.ROLE
            );
            const roles: string[] = JSON.parse(roleList);
            roles.forEach((role) => {
              if (!node.roles.has(role)) {
                node.roles.add(role);
              }
            });

            const multiAddrList = await this.client.askToPeer(
              ma,
              config.protocols.MULTIADDRES
            );
            const multiaddrrs: string[] = JSON.parse(multiAddrList);
            multiaddrrs.forEach((ma) => {
              if (!node.addresses.has(ma)) {
                node.addresses.add(ma);
              }
            });
          }
        });
      }
    }
  }

  private connectingAnalizer(): void {
    const relayCount = Array.from(this.nodes.values()).filter(
      (n) => n.roles.has(config.roles.RELAY) && n.isConnect
    ).length;
    const nodeCount = Array.from(this.nodes.values()).filter(
      (n) => n.roles.has(config.roles.NODE) && n.isConnect
    ).length;

    for (const nodePair of this.nodes) {
      const node = nodePair[1];
      if (!node.peerId) continue;

      if (!node.isConnect) {
        this.taskQueue.push(async () => {
          const conection = await this.tryConnectNode(node);
          node.connection = conection;
        });
      }

      if (node.isConnect && node.protocols.has(config.protocols.PING)) {
        this.taskQueue.push(async () => {
          await this.trySendPing(node);
        });
      }
    }
  }

  private async tryConnectNode(node: Node): Promise<Connection | undefined> {
    try {
      if (node.addresses.size > 0) {
        const multiaddrs = Array.from(node.addresses).map((a) => multiaddr(a));
        const filteredAddrs = multiaddrs.filter((ma) => !isLocal(ma));
        if (filteredAddrs.length > 0) {
          console.log(
            `Try connect to ${node.peerId?.toString()} with address ${filteredAddrs[0].toString()}`
          );
          const connect = await this.client.connectTo(filteredAddrs[0]);
          if (connect) {
            node.connection = connect;
            node.isConnect = true;
            console.log(`Connected success to ${node.peerId?.toString()}`);
            return connect;
          }
        } else {
          console.log(`All addresses are local for ${node.peerId?.toString()}`);
        }
      }
      return undefined;
    } catch (error) {
      console.error("Error in tryConnectNode", error);
      return undefined;
    }
  }

  private async trySendPing(node: Node): Promise<void> {
    if (!node.connection) return;

    try {
      const startTime = Date.now();

      const result = await this.client.askToConnection(
        node.connection,
        config.protocols.PING
      );
      const isPingSuccess = result === "PONG";
      if (!isPingSuccess) {
        console.log(
          `Ping node ${node.peerId?.toString()} ${isPingSuccess ? "success" : "fail"} (${Date.now() - startTime} ms)`
        );
      }
    } catch (error) {
      console.error("Error in trySendPing", error);
    }
  }
}
