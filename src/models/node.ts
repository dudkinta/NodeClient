import type { Connection, PeerId } from "@libp2p/interface";
import { NodeStrategy } from "../services/node-strategy.js";
export class Node {
  peerId: PeerId | undefined;
  connection: Connection | undefined;
  addresses: Set<string>;
  protocols: Set<string>;
  roles: Set<string>;
  isConnect: boolean = false;
  strategy: NodeStrategy;
  candidates: Map<string, string>;
  constructor(
    strategy: NodeStrategy,
    peerId: PeerId | undefined,
    connection: Connection | undefined
  ) {
    this.strategy = strategy;
    this.peerId = peerId;
    this.connection = connection;
    this.addresses = new Set();
    this.protocols = new Set();
    this.roles = new Set();
    this.candidates = new Map();
  }

  async executeStrategy() {
    await this.strategy.execute(this);
  }
}
