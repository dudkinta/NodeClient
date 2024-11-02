declare module "config.json" {
  interface Protocols {
    ROLE: string;
    PEER_LIST: string;
    CHAT: string;
  }
  interface Roles {
    RELAY: string;
    NODE: string;
  }
  interface Relay {
    PEER: string;
    ADDRESS: string;
    PORT: number;
  }

  interface Config {
    protocols: Protocols;
    roles: Roles;
    relay: Relay[];
  }

  const value: Config;
  export default value;
}
