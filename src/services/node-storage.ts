import { Node } from "../models/node.js";
import ConfigLoader from "../helpers/config-loader.js";
import { isLocalAddress, isDirect, isWEBRTC } from "../helpers/check-ip.js";
import { error } from "console";

type RequestConnect = (addrr: string) => Promise<void>;
type RequestDisconnect = (addrr: string) => Promise<void>;
type RequestRoles = (node: Node) => Promise<string[] | undefined>;

type RequestMultiaddrs = (node: Node) => Promise<string[] | undefined>;

type RequestConnectedPeers = (
  node: Node
) => Promise<Map<string, string> | undefined>;

type RequestPing = (addrr: string) => Promise<number | undefined>;

export class NodeStorage extends Map<string, Node> {
  private relayCount: number = 0;
  private nodeCount: number = 0;
  private unknownCount: number = 0;
  private maxRelayCount: number = 2;
  private maxNodeCount: number = 20;
  private config = ConfigLoader.getInstance().getConfig();
  private requestConnect: RequestConnect;
  private requestDisconnect: RequestDisconnect;
  private requestRoles: RequestRoles;
  private requestMultiaddrs: RequestMultiaddrs;
  private requestConnectedPeers: RequestConnectedPeers;
  private requestPing: RequestPing;
  private penaltyNodes: string[] = [];
  private localPeer: string | undefined;
  constructor(
    requestConnect: RequestConnect,
    requestDisconnect: RequestDisconnect,
    requestRoles: RequestRoles,
    requestMultiaddrs: RequestMultiaddrs,
    requestConnectedPeers: RequestConnectedPeers,
    requestPing: RequestPing
  ) {
    super();
    this.requestConnect = requestConnect;
    this.requestDisconnect = requestDisconnect;
    this.requestRoles = requestRoles;
    this.requestMultiaddrs = requestMultiaddrs;
    this.requestConnectedPeers = requestConnectedPeers;
    this.requestPing = requestPing;
  }

  set(key: string, value: Node): this {
    super.set(key, value);
    setTimeout(async () => {
      await this.waitConnect(value);
      if (value.isConnect()) {
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
    await this.counterByRoles();
    //this.optimizeConnection();
    this.counterByConnections();
  }

  private async counterByRoles() {
    let rCount = 0;
    let nCount = 0;
    let uCount = 0;
    for (const [key, node] of this) {
      if (!node) {
        uCount++;
        this.printUnknownNode(key, "node is undefined");
        continue;
      }
      if (!node.isConnect()) {
        uCount++;
        this.printUnknownNode(key, "connection status is not open");
        continue;
      }
      if (node.roles.has(this.config.roles.RELAY)) {
        rCount++;
      } else if (node.roles.has(this.config.roles.NODE)) {
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
      const relay = this.config.relay[0];
      const address = `/ip4/${relay.ADDRESS}/tcp/${relay.PORT}/ws/p2p/${relay.PEER}`;
      await this.requestConnect(address).catch((error) => {
        console.error(`Error in promise requestConnect: ${error}`);
      });
    }
    console.log(
      `NetworkStrategy-> Relay count: ${this.relayCount}, Node count: ${this.nodeCount}, Unknown count: ${this.unknownCount}`
    );
  }

  private counterByConnections() {
    let relayConnections = 0;
    let directConnections = 0;
    for (const [key, node] of this) {
      if (!node) {
        continue;
      }
      if (!node.isConnect()) {
        continue;
      }
      node.connections.forEach((conn) => {
        if (isDirect(conn.remoteAddr.toString())) {
          /*console.log(
            `NetworkStrategy-> Direct connection: ${conn.remoteAddr.toString()}`
          );*/
          directConnections++;
        } else {
          //console.log(conn);
          relayConnections++;
        }
      });
    }
    console.log(
      `NetworkStrategy-> Relay connections: ${relayConnections}, Direct connections: ${directConnections}`
    );
  }

  private optimizeConnection() {
    for (const [key, node] of this) {
      if (!node) {
        continue;
      }
      if (!node.isConnect()) {
        continue;
      }

      if (node.connections.size > 1) {
        node.connections.forEach(async (conn) => {
          if (conn.limits != undefined) {
            console.log(`Request disconnect: ${conn.remoteAddr.toString()}`);
            this.requestDisconnect(conn.remoteAddr.toString()).catch(
              (error) => {
                console.error(`Error in promise requestDisconnect: ${error}`);
              }
            );
          }
        });
      }
    }
  }

  private async checkStatus() {
    this.removeDeadNodes();

    for (const [key, node] of this) {
      if (!node) {
        continue;
      }
      if (!node.isConnect()) {
        continue;
      }
      if (
        node.roles.size == 0 &&
        node.protocols.has(this.config.protocols.ROLE)
      ) {
        await this.getRoles(node);
      }
      if (
        node.addresses.size == 0 &&
        node.protocols.has(this.config.protocols.MULTIADDRES)
      ) {
        await this.getMultiaddrs(node);
      }
      await this.findPeer(node);
      await this.checkDirectAddress(node);
    }
  }

  private removeDeadNodes() {
    for (const [key, node] of this) {
      if (!node) {
        this.penaltyNodes.push(key);
        continue;
      }
      if (!node.isConnect()) {
        this.penaltyNodes.push(key);
        continue;
      }
      if (node.roles.size == 0) {
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
    while (!node.isConnect() && countDelay < 20) {
      await this.delay(500);
      countDelay++;
    }
  }

  private async getRoles(node: Node): Promise<void> {
    let roles: string[] | undefined;
    roles = await this.requestRoles(node).catch((error) => {
      console.error(`Error in promise getRoles: ${error}`);
      return undefined;
    });
    if (roles != undefined) {
      roles.forEach((role) => {
        node.roles.add(role);
      });
    }
  }

  private async findPeer(node: Node): Promise<void> {
    if (node.protocols.has(this.config.protocols.PEER_LIST)) {
      const connectedPeers = await this.requestConnectedPeers(node).catch(
        (error) => {
          console.error(`Error in promise requestConnectedPeers: ${error}`);
          return undefined;
        }
      );
      if (connectedPeers) {
        connectedPeers.forEach(async (peerInfo: any) => {
          if (
            peerInfo.peerId == node.peerId ||
            peerInfo.peerId == this.localPeer ||
            this.has(peerInfo.peerId)
          ) {
            return;
          }
          if (node.roles.has(this.config.roles.RELAY)) {
            const connecton = node.getOpenedConnection();
            if (!connecton) return undefined;

            const relayAddress = node
              .getOpenedConnection()!
              .remoteAddr.toString();
            const fullAddress = `${relayAddress}/p2p-circuit/webrtc/p2p/${peerInfo.peerId}`;
            const lat = await this.requestPing(fullAddress).catch((error) => {
              console.error(`Error in promise requestPing: ${error}`);
              return undefined;
            });
            if (lat && lat < 10000 && this.nodeCount < this.maxNodeCount) {
              await this.requestConnect(fullAddress).catch((error) => {
                console.error(`Error in promise requestConnect: ${error}`);
              });
            }
          }
          if (node.roles.has(this.config.roles.NODE)) {
            if (!isWEBRTC(peerInfo.address)) {
              const lat = await this.requestPing(peerInfo.address).catch(
                (error) => {
                  console.error(`Error in promise requestPing: ${error}`);
                  return undefined;
                }
              );
              console.log(
                `Strategy-> Node ping to ${peerInfo.address}: ${lat}`
              );
              if (lat && lat < 10000 && this.nodeCount < this.maxNodeCount) {
                await this.requestConnect(peerInfo.address).catch((error) => {
                  console.error(`Error in promise requestConnect: ${error}`);
                });
              }
            }
          }
        });
      }
    }
  }

  private async getMultiaddrs(node: Node): Promise<void> {
    console.log(`Strategy(${node.peerId?.toString()})-Getting multiaddrs`);
    if (
      node.protocols.has(this.config.protocols.MULTIADDRES) &&
      node.roles.has(this.config.roles.NODE)
    ) {
      let multiaddrs: string[] | undefined;
      while (!multiaddrs) {
        multiaddrs = await this.requestMultiaddrs(node).catch((error) => {
          console.error(`Error in promise getMultiaddrs: ${error}`);
          return undefined;
        });
        if (multiaddrs) {
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

  private async checkDirectAddress(node: Node): Promise<void> {
    if (node.roles.has(this.config.roles.NODE)) {
      for (const [address, isAvailable] of node.addresses) {
        if (isAvailable) {
          continue;
        }
        if (
          isLocalAddress(address) ||
          address.includes("p2p-circuit") ||
          isWEBRTC(address)
        ) {
          continue;
        }
        try {
          const lat = await this.requestPing(address).catch((error) => {
            console.error(`Error in promise checkDirectAddress: ${error}`);
            return undefined;
          });
          console.log(
            `Strategy-> Node directPing (${node.peerId?.toString()}) to ${address}: ${lat}`
          );
          if (lat && lat < 10000) {
            node.addresses.set(address, true);
          }
        } catch (error) {
          console.error(`Error in checkDirectAddress: ${error}`);
        }
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
