import { EventEmitter } from "events";
import { Connection } from "@libp2p/interface";
import { Node } from "../models/node.js";
import { P2PClient } from "../p2p-сlient.js";
import config from "./../config.json" assert { type: "json" };
type RequestConnect = (
  client: P2PClient,
  address: string
) => Promise<Connection | undefined>;
type RequestRoles = (
  client: P2PClient,
  node: Node
) => Promise<string[] | undefined>;
type RequestMultiaddrs = (
  client: P2PClient,
  node: Node
) => Promise<string[] | undefined>;
type RequestConnectedPeers = (
  client: P2PClient,
  node: Node
) => Promise<Map<string, string> | undefined>;
export interface FoundPeerEvent {
  peer: string;
  addrr: string;
}
export interface RemovePeerEvent {
  peer: string;
}

export class NodeStrategy extends EventEmitter {
  private requestConnect: RequestConnect;
  private requestRoles: RequestRoles;
  private requestMultiaddrs: RequestMultiaddrs;
  private requestConnectedPeers: RequestConnectedPeers;
  private client: P2PClient;
  private pingInterval: NodeJS.Timeout | undefined;
  private findConnectedPeer: NodeJS.Timeout | undefined;

  constructor(
    client: P2PClient,
    requestConnect: RequestConnect,
    requestRoles: RequestRoles,
    requestMultiaddrs: RequestMultiaddrs,
    requestConnectedPeers: RequestConnectedPeers
  ) {
    super();
    this.client = client;
    this.requestConnect = requestConnect;
    this.requestRoles = requestRoles;
    this.requestMultiaddrs = requestMultiaddrs;
    this.requestConnectedPeers = requestConnectedPeers;
  }
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async execute(node: Node): Promise<void> {
    let roles: string[] | undefined;
    while (roles == undefined) {
      roles = await this.requestRoles(this.client, node);
      if (roles != undefined) {
        roles.forEach((role) => {
          node.roles.add(role);
          console.log(
            `Strategy->Role ${role} added to node ${node.peerId?.toString()}`
          );
        });
      } else {
        console.log("Strategy->Waiting for roles");
        await this.delay(1000);
      }
    }
    if (node.roles.has(config.roles.NODE)) {
      let multiaddrs: string[] | undefined;
      while (multiaddrs == undefined) {
        multiaddrs = await this.requestMultiaddrs(this.client, node);
        if (multiaddrs != undefined) {
          multiaddrs.forEach((multiaddr) => {
            if (multiaddr && !node.addresses.has(multiaddr)) {
              node.addresses.add(multiaddr);
              console.log(
                `Strategy->Multiaddr ${multiaddr} added to node ${node.peerId?.toString()}`
              );
            }
          });
        } else {
          console.log("Strategy->Waiting for multiaddrs");
          await this.delay(1000);
        }
      }
    }

    this.findConnectedPeer = setInterval(async () => {
      const connectedPeers = await this.requestConnectedPeers(
        this.client,
        node
      );
      if (connectedPeers) {
        connectedPeers.forEach((peerInfo: any) => {
          const peer: string = peerInfo.peerId;
          let addrr: string = peerInfo.address;
          if (node.roles.has(config.roles.RELAY)) {
            const relayAddress = node.connection!.remoteAddr.toString();
            const fullAddress = `${relayAddress}/p2p-circuit/webrtc/p2p/${peer}`;
            addrr = fullAddress;
          } else {
            addrr = addrr;
          }
          if (!node.candidates.has(peer)) {
            node.candidates.set(peer, addrr);
            this.emit("foundPeer", { peer, addrr });
          }
        });
      }
    }, 30000);
    /*
    this.pingInterval = setInterval(async () => {
      if (!node.connection) {
        return;
      }
      if (!node.isConnect) {
        return;
      }

      const lanency = this.client.pingCandidate(
        node.connection.remoteAddr.toString()
      );
      if (!lanency) {
        clearInterval(this.pingInterval);
        clearInterval(this.findConnectedPeer);
        console.log("Node is not reachable");
        if (node.peerId) {
          await this.client.disconnectFrom(node.peerId);
        }
        node.isConnect = false;
        node.connection = undefined;
        node.peerId = undefined;
      }
    }, 30000);*/
  }
}
