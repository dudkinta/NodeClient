import type { Connection, PeerId } from "@libp2p/interface";
export class Node {
  peerId: PeerId | undefined;
  connections: Set<Connection>;
  addresses: Map<string, Boolean>;
  protocols: Set<string>;
  roles: Set<string>;
  constructor(peerId: PeerId | undefined, connection: Connection | undefined) {
    this.peerId = peerId;
    this.connections = new Set();
    if (connection) {
      this.connections.add(connection);
    }
    this.addresses = new Map();
    this.protocols = new Set();
    this.roles = new Set();
  }

  isConnect(): boolean {
    if (this.connections.size == 0) return false;
    return (
      Array.from(this.connections).filter((conn) => conn.status == "open")
        .length > 0
    );
  }

  getOpenedConnection(): Connection | undefined {
    if (this.connections.size == 0) return undefined;

    let connection = undefined;
    const allConnections = Array.from(this.connections);
    allConnections.map((conn) => {
      connection = conn;
    });
    return connection;
  }

  getOpenedConnections(): Connection | undefined {
    if (this.connections.size == 0) return undefined;

    let connection = undefined;
    const allConnections = Array.from(this.connections);
    allConnections.map((conn) => {
      connection = conn;
    });
    return connection;
  }
}
