import { P2PClient } from "./p2p-сlient.js";

const RELAY_PEER: string =
  "12D3KooWKQ8DqitPP7ivNFn8QJtA6K3fa8Zsd4M7ea8CFjqxQQcr";
const RELAY_ADDRESS: string = "31.172.66.148";
const RELAY_PORT: number = 6006;

async function main(): Promise<void> {
  const client = new P2PClient(RELAY_ADDRESS, RELAY_PORT, RELAY_PEER);
  await client.startNode();
}

main().catch((err: unknown) => {
  console.error("An error occurred:", err);
  process.exit(1);
});
