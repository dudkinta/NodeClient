import { Node } from "../models/node.js";
import config from "../config.json" assert { type: "json" };
import { Connection } from "@libp2p/interface";

type RequestConnect = (addrr: string) => Promise<Connection | undefined>;
type RequestRoles = (node: Node) => Promise<string[] | undefined>;

type RequestMultiaddrs = (node: Node) => Promise<string[] | undefined>;

type RequestConnectedPeers = (
  node: Node
) => Promise<Map<string, string> | undefined>;

type RequestPing = (addrr: string) => Promise<number | undefined>;

export class NodeStorage extends Map<string, Node> {
  relayCount: number = 0;
  nodeCount: number = 0;
  unknownCount: number = 0;
  maxRelayCount: number = 2;
  maxNodeCount: number = 20;

  private requestConnect: RequestConnect;
  private requestRoles: RequestRoles;
  private requestMultiaddrs: RequestMultiaddrs;
  private requestConnectedPeers: RequestConnectedPeers;
  private requestPing: RequestPing;
  private penaltyNodes: string[] = [];
  private localPeer: string | undefined;
  constructor(
    requestConnect: RequestConnect,
    requestRoles: RequestRoles,
    requestMultiaddrs: RequestMultiaddrs,
    requestConnectedPeers: RequestConnectedPeers,
    requestPing: RequestPing
  ) {
    super();
    this.requestConnect = requestConnect;
    this.requestRoles = requestRoles;
    this.requestMultiaddrs = requestMultiaddrs;
    this.requestConnectedPeers = requestConnectedPeers;
    this.requestPing = requestPing;
  }

  set(key: string, value: Node): this {
    super.set(key, value);
    setTimeout(async () => {
      await this.waitConnect(value);
      if (value.connection && value.connection.status == "open") {
        await this.getRoles(value);
        if (value.roles.size > 0) {
          await this.getMultiaddrs(value);
          await this.findPeer(value);
        }
      }
    }, 0);

    return this;
  }

  async start(localPeer: string): Promise<void> {
    this.localPeer = localPeer;
    await this.counter();
    setInterval(async () => {
      await this.checkStatus();
      await this.counter();
    }, 10000);
  }

  private printUnknownNode(key: string, error: string) {
    console.log(`NetworkStrategy-> Unknown node: ${key} Error: ${error}`);
  }

  private async counter() {
    let rCount = 0;
    let nCount = 0;
    let uCount = 0;
    for (const [key, node] of this) {
      if (!node) {
        uCount++;
        this.printUnknownNode(key, "node is undefined");
        continue;
      }
      if (!node.connection) {
        uCount++;
        this.printUnknownNode(key, "connection is undefined");
        continue;
      }
      if (node.connection.status != "open") {
        uCount++;
        this.printUnknownNode(key, "connection status is not open");
        continue;
      }
      if (node.roles.has(config.roles.RELAY)) {
        rCount++;
      } else if (node.roles.has(config.roles.NODE)) {
        nCount++;
      } else {
        this.printUnknownNode(key, "node role is undefined");
        uCount++;
      }
    }
    this.relayCount = rCount;
    this.nodeCount = nCount;
    this.unknownCount = uCount;
    if (rCount == 0) {
      const relay = config.relay[0];
      if (!this.has(relay.PEER)) {
        const address = `/ip4/${relay.ADDRESS}/tcp/${relay.PORT}/ws/p2p/${relay.PEER}`;
        await this.requestConnect(address);
      }
    }
    console.log(
      `NetworkStrategy-> Relay count: ${this.relayCount}, Node count: ${this.nodeCount}, Unknown count: ${this.unknownCount}`
    );
  }

  private async checkStatus() {
    this.removeDeadNodes();

    for (const [key, node] of this) {
      if (!node) {
        continue;
      }
      if (!node.connection) {
        continue;
      }
      if (node.connection.status != "open") {
        continue;
      }
      if (node.roles.size == 0 && node.protocols.has(config.protocols.ROLE)) {
        await this.getRoles(node);
      }
      if (
        node.addresses.size == 0 &&
        node.protocols.has(config.protocols.MULTIADDRES)
      ) {
        await this.getMultiaddrs(node);
      }
      await this.findPeer(node);
    }
  }

  private removeDeadNodes() {
    for (const [key, node] of this) {
      if (!node) {
        this.penaltyNodes.push(key);
        continue;
      }
      if (!node.connection) {
        this.penaltyNodes.push(key);
        continue;
      }
      if (node.connection.status != "open") {
        this.penaltyNodes.push(key);
        continue;
      }
    }
    const keysForDelete = [
      ...this.penaltyNodes.reduce(
        (map, node) => map.set(node, (map.get(node) || 0) + 1),
        new Map()
      ),
    ]
      .filter(([, count]) => count > 10)
      .map(([node]) => node);

    keysForDelete.forEach((key) => {
      console.log(`NetworkStrategy-> Delete node: ${key}`);
      this.delete(key);
    });
    this.penaltyNodes = this.penaltyNodes.filter(
      (node) => !keysForDelete.includes(node)
    );
  }

  private async waitConnect(node: Node) {
    let countDelay = 0;
    while (
      !(node.connection && node.connection.status == "open") ||
      countDelay < 20
    ) {
      await this.delay(500);
      countDelay++;
    }
  }

  private async getRoles(node: Node): Promise<void> {
    let roles: string[] | undefined;
    roles = await this.requestRoles(node);
    if (roles != undefined) {
      roles.forEach((role) => {
        node.roles.add(role);
      });
    }
  }

  private async findPeer(node: Node): Promise<void> {
    if (node.protocols.has(config.protocols.PEER_LIST)) {
      const connectedPeers = await this.requestConnectedPeers(node);
      if (connectedPeers) {
        connectedPeers.forEach(async (peerInfo: any) => {
          if (
            peerInfo.peerId == node.peerId ||
            peerInfo.peerId == this.localPeer ||
            this.has(peerInfo.peerId)
          ) {
            return;
          }
          if (node.roles.has(config.roles.RELAY)) {
            const relayAddress = node.connection!.remoteAddr.toString();
            const fullAddress = `${relayAddress}/p2p-circuit/webrtc/p2p/${peerInfo.peerId}`;
            const lat = await this.requestPing(fullAddress);
            console.log(`Strategy-> Relay ping to ${fullAddress}: ${lat}`);
            if (lat && lat < 10000) {
              await this.requestConnect(fullAddress);
            }
          }
          if (node.roles.has(config.roles.NODE)) {
            const lat = await this.requestPing(peerInfo.address);
            console.log(`Strategy-> Node ping to ${peerInfo.address}: ${lat}`);
            if (lat && lat < 10000) {
              await this.requestConnect(peerInfo.address);
            }
          }
        });
      }
    }
  }

  private async getMultiaddrs(node: Node): Promise<void> {
    console.log(`Strategy(${node.peerId?.toString()})-Getting multiaddrs`);
    if (
      node.protocols.has(config.protocols.MULTIADDRES) &&
      node.roles.has(config.roles.NODE)
    ) {
      let multiaddrs: string[] | undefined;
      while (multiaddrs == undefined) {
        multiaddrs = await this.requestMultiaddrs(node);
        if (multiaddrs != undefined) {
          multiaddrs.forEach((multiaddr) => {
            if (multiaddr && !node.addresses.has(multiaddr)) {
              node.addresses.set(multiaddr, false);
            }
          });
        } else {
          console.log(
            `Strategy(${node.peerId?.toString()})-Waiting for multiaddrs. Node adresses count: ${node.addresses.size}`
          );
          await this.delay(1000);
        }
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}