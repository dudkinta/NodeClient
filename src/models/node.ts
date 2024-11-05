import type { Connection, PeerId } from "@libp2p/interface";
export class Node {
  peerId: PeerId | undefined;
  connection: Connection | undefined;
  addresses: Map<string, Boolean>;
  protocols: Set<string>;
  roles: Set<string>;
  constructor(peerId: PeerId | undefined, connection: Connection | undefined) {
    this.peerId = peerId;
    this.connection = connection;
    this.addresses = new Map();
    this.protocols = new Set();
    this.roles = new Set();
  }
}
