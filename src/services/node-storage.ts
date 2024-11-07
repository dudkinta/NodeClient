import { Node } from "../models/node.js";
import ConfigLoader from "../helpers/config-loader.js";
import { isLocalAddress, isDirect, isWEBRTC } from "../helpers/check-ip.js";
import { Connection } from "@libp2p/interface";

type RequestConnect = (addrr: string) => Promise<Connection | undefined>;
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
  private penaltyNodes: string[] = [];
  private localPeer: string | undefined;
  private reconnectList: Map<string, string> = new Map();
  private config = ConfigLoader.getInstance().getConfig();
  private requestConnect: RequestConnect;
  private requestDisconnect: RequestDisconnect;
  private requestRoles: RequestRoles;
  private requestMultiaddrs: RequestMultiaddrs;
  private requestConnectedPeers: RequestConnectedPeers;
  private requestPing: RequestPing;

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
    try {
      super.set(key, value);
      setTimeout(async () => {
        try {
          await this.waitConnect(value).catch((error) => {
            console.error(`Error in promise waitConnect: ${error}`);
          });
          if (value.isConnect()) {
            await this.getRoles(value).catch((error) => {
              console.error(`Error in promise getRoles: ${error}`);
            });
            if (value.roles.size > 0) {
              await this.getMultiaddrs(value).catch((error) => {
                console.error(`Error in promise getMultiaddrs: ${error}`);
              });
              await this.findPeer(value).catch((error) => {
                console.error(`Error in promise findPeer: ${error}`);
              });
            }
          }
        } catch (error) {
          console.error(`Error in setTimeout callback: ${error}`);
        }
      }, 0);

      return this;
    } catch (error) {
      console.error(`Error in set: ${error}`);
      return this;
    }
  }

  async start(localPeer: string): Promise<void> {
    try {
      this.localPeer = localPeer;
      await this.counter().catch((error) => {
        console.error(`Error in promise counter: ${error}`);
      });
      setInterval(async () => {
        try {
          await this.checkStatus().catch((error) => {
            console.error(`Error in promise checkStatus: ${error}`);
          });
          await this.counter().catch((error) => {
            console.error(`Error in promise counter: ${error}`);
          });
        } catch (error) {
          console.error(`Error in setInterval callback: ${error}`);
        }
      }, 10000);
    } catch (error) {
      console.error(`Error in start: ${error}`);
    }
  }

  private printUnknownNode(key: string, error: string) {
    try {
      console.log(`NetworkStrategy-> Unknown node: ${key} Error: ${error}`);
    } catch (error) {
      console.error(`Error in printUnknownNode: ${error}`);
    }
  }

  private async counter(): Promise<void> {
    try {
      await this.counterByRoles().catch((error) => {
        console.error(`Error in promise counterByRoles: ${error}`);
      });
      await this.optimizeConnection().catch((error) => {
        console.error(`Error in promise optimizeConnection: ${error}`);
      });
      try {
        this.counterByConnections();
      } catch (error) {
        console.error(`Error in counterByConnections: ${error}`);
      }
      await this.reconnectDirect().catch((error) => {
        console.error(`Error in promise reconnectDirect: ${error}`);
      });
    } catch (error) {
      console.error(`Error in counter: ${error}`);
    }
  }

  private async reconnectDirect(): Promise<void> {
    try {
      for (const node of this.reconnectList) {
        const conn = await this.requestConnect(node[1]).catch((error) => {
          console.error(`Error in promise requestConnect: ${error}`);
          return undefined;
        });
        if (conn) {
          console.log(
            `Reconnect to ${node[1]}: ConnectionStatus: ${conn?.status}`
          );
          if (conn.status == "open") {
            console.log(`Reconnect to ${node[1]} is success`);
            this.reconnectList.delete(node[0]);
          }
        } else {
          console.error(`Reconnect to ${node[1]} is failed`);
        }
      }
    } catch (error) {
      console.error(`Error in reconnectDirect: ${error}`);
    }
  }

  private async counterByRoles(): Promise<void> {
    try {
      let rCount = 0;
      let nCount = 0;
      let uCount = 0;
      for (const [key, node] of this) {
        try {
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
        } catch (error) {
          console.error(`Error in counterByRoles loop: ${error}`);
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
    } catch (error) {
      console.error(`Error in counterByRoles: ${error}`);
    }
  }

  private counterByConnections() {
    try {
      let relayConnections = 0;
      let directConnections = 0;
      for (const [key, node] of this) {
        try {
          if (!node) {
            continue;
          }
          if (!node.isConnect()) {
            continue;
          }
          node.connections.forEach((conn) => {
            try {
              if (isDirect(conn.remoteAddr.toString())) {
                directConnections++;
              } else {
                relayConnections++;
              }
            } catch (error) {
              console.error(`Error in counterByConnections forEach: ${error}`);
            }
          });
        } catch (error) {
          console.error(`Error in counterByConnections loop: ${error}`);
        }
      }
      console.log(
        `NetworkStrategy-> Relay connections: ${relayConnections}, Direct connections: ${directConnections}`
      );
    } catch (error) {
      console.error(`Error in counterByConnections: ${error}`);
    }
  }

  private async optimizeConnection(): Promise<void> {
    try {
      for (const [key, node] of this) {
        try {
          if (!node) {
            continue;
          }

          const openAddresses = [...node.addresses.entries()].filter(
            (addrr) => addrr[1] && isDirect(addrr[0])
          );
          if (openAddresses.length > 0) {
            const directAddress = openAddresses[0][0];
            const isConnectedDirectAddress = Array.from(node.connections).some(
              (conn) => {
                return conn.remoteAddr.toString() === directAddress;
              }
            );
            console.log(`Direct addresses ${directAddress}`);
            console.log(
              `Is connected direct address: ${isConnectedDirectAddress}`
            );
            if (!isConnectedDirectAddress) {
              console.log(`Add to ReconnectList: ${directAddress}`);
              this.reconnectList.set(key, directAddress);
              node.connections.forEach(async (conn) => {
                await this.requestDisconnect(conn.remoteAddr.toString()).catch(
                  (error) => {
                    console.error(
                      `Error in promise requestDisconnect: ${error}`
                    );
                  }
                );
              });
              this.delete(key);
            }
          }
        } catch (error) {
          console.error(`Error in optimizeConnection loop: ${error}`);
        }
      }
    } catch (error) {
      console.error(`Error in optimizeConnection: ${error}`);
    }
  }

  private async checkStatus() {
    try {
      this.removeDeadNodes();

      for (const [key, node] of this) {
        try {
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
        } catch (error) {
          console.error(`Error in checkStatus loop: ${error}`);
        }
      }
    } catch (error) {
      console.error(`Error in checkStatus: ${error}`);
    }
  }

  private removeDeadNodes() {
    try {
      for (const [key, node] of this) {
        try {
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
        } catch (error) {
          console.error(`Error in removeDeadNodes loop: ${error}`);
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
        try {
          console.log(`NetworkStrategy-> Delete node: ${key}`);
          this.delete(key);
        } catch (error) {
          console.error(`Error deleting node ${key}: ${error}`);
        }
      });
      this.penaltyNodes = this.penaltyNodes.filter(
        (node) => !keysForDelete.includes(node)
      );
    } catch (error) {
      console.error(`Error in removeDeadNodes: ${error}`);
    }
  }

  private async waitConnect(node: Node) {
    try {
      let countDelay = 0;
      while (!node.isConnect() && countDelay < 20) {
        await this.delay(500);
        countDelay++;
      }
    } catch (error) {
      console.error(`Error in waitConnect: ${error}`);
    }
  }

  private async getRoles(node: Node): Promise<void> {
    try {
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
    } catch (error) {
      console.error(`Error in getRoles: ${error}`);
    }
  }

  private async findPeer(node: Node): Promise<void> {
    try {
      if (node.protocols.has(this.config.protocols.PEER_LIST)) {
        const connectedPeers = await this.requestConnectedPeers(node).catch(
          (error) => {
            console.error(`Error in promise requestConnectedPeers: ${error}`);
            return undefined;
          }
        );
        if (connectedPeers) {
          connectedPeers.forEach(async (peerInfo: any) => {
            try {
              if (
                peerInfo.peerId == node.peerId ||
                peerInfo.peerId == this.localPeer ||
                this.has(peerInfo.peerId) ||
                this.reconnectList.has(peerInfo.peerId.toString())
              ) {
                return;
              }
              if (node.roles.has(this.config.roles.RELAY)) {
                const connection = node.getOpenedConnection();
                if (!connection) return;

                const relayAddress = connection.remoteAddr.toString();
                const fullAddress = `${relayAddress}/p2p-circuit/webrtc/p2p/${peerInfo.peerId}`;
                const lat = await this.requestPing(fullAddress).catch(
                  (error) => {
                    console.error(`Error in promise requestPing: ${error}`);
                    return undefined;
                  }
                );
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
                  if (
                    lat &&
                    lat < 10000 &&
                    this.nodeCount < this.maxNodeCount
                  ) {
                    await this.requestConnect(peerInfo.address).catch(
                      (error) => {
                        console.error(
                          `Error in promise requestConnect: ${error}`
                        );
                      }
                    );
                  }
                }
              }
            } catch (error) {
              console.error(`Error in findPeer forEach: ${error}`);
            }
          });
        }
      }
    } catch (error) {
      console.error(`Error in findPeer: ${error}`);
    }
  }

  private async getMultiaddrs(node: Node): Promise<void> {
    try {
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
              try {
                if (multiaddr && !node.addresses.has(multiaddr)) {
                  node.addresses.set(multiaddr, false);
                }
              } catch (error) {
                console.error(`Error in getMultiaddrs forEach: ${error}`);
              }
            });
          } else {
            console.log(
              `Strategy(${node.peerId?.toString()})-Waiting for multiaddrs. Node addresses count: ${node.addresses.size}`
            );
            await this.delay(1000);
          }
        }
      }
    } catch (error) {
      console.error(`Error in getMultiaddrs: ${error}`);
    }
  }

  private async checkDirectAddress(node: Node): Promise<void> {
    try {
      if (node.roles.has(this.config.roles.NODE)) {
        for (const [address, isAvailable] of node.addresses) {
          try {
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
            console.error(`Error in checkDirectAddress loop: ${error}`);
          }
        }
      }
    } catch (error) {
      console.error(`Error in checkDirectAddress: ${error}`);
    }
  }

  private async delay(ms: number): Promise<void> {
    try {
      return new Promise((resolve) => setTimeout(resolve, ms));
    } catch (error) {
      console.error(`Error in delay: ${error}`);
    }
  }
}
