import type { Connection, PeerId } from "@libp2p/interface";

export class Node {
  peerId: PeerId | undefined;
  connection: Connection | undefined;
  addresses: Set<string>;
  protocols: Set<string>;
  roles: Set<string>;
  peers: Map<string, string>;
  isConnect: boolean = false;

  constructor(peerId?: PeerId, connection?: Connection) {
    this.peerId = peerId;
    this.connection = connection;
    this.addresses = new Set();
    this.protocols = new Set();
    this.roles = new Set();
    this.peers = new Map();
    if (this.connection) {
      this.addresses.add(this.connection.remoteAddr.toString());
    }
  }
}
