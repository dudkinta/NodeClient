import { P2PClient } from "./p2p-сlient.js";
import { NetworkService } from "./services/network-service.js";

async function main(): Promise<void> {
  const networkService = new NetworkService(new P2PClient());
  await networkService.startAsync();
}

main().catch((err: unknown) => {
  console.error("An error occurred:", err);
  process.exit(1);
});
