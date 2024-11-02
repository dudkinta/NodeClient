import { P2PClient, ConnectionOpenEvent } from "./p2p-сlient.js";
//import packageJson from "../package.json";
import { multiaddr } from "@multiformats/multiaddr";

const RELAY_PEER: string =
  "12D3KooWKQ8DqitPP7ivNFn8QJtA6K3fa8Zsd4M7ea8CFjqxQQcr";
const RELAY_ADDRESS: string = "31.172.66.148";
const RELAY_PORT: number = 6006;
const peerConnections = new Map();

async function main(): Promise<void> {
  const client = new P2PClient();
  await client.startNode();

  client.on("connection:open", (event: ConnectionOpenEvent) => {
    const { peerId, conn } = event;
    peerConnections.set(peerId, conn);
    console.log(
      `[${new Date().toISOString()}] MainClass -> Connected to peer:', ${peerId.toString()}`
    );
    client.askToConnection(conn, "/peers/list").then((result) => {
      console.log(
        `[${new Date().toISOString()}] MainClass -> Peer response:', ${result}`
      );
    });
    console.log(conn);
  });

  await client.connectTo(
    multiaddr(`/ip4/${RELAY_ADDRESS}/tcp/${RELAY_PORT}/p2p/${RELAY_PEER}`)
  );
}

main().catch((err: unknown) => {
  console.error("An error occurred:", err);
  process.exit(1);
});
