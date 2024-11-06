import { P2PClient } from "./p2p-сlient.js";
import { NetworkService } from "./services/nerwork-service.js";
import ConfigLoader from "./helpers/config-loader.js";

async function main(): Promise<void> {
  try {
    await ConfigLoader.initialize();
    const networkService = new NetworkService(new P2PClient());
    await networkService.startAsync();
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error occurred:", error.message);
      console.error("Stack trace:", error.stack); // Вывод стека вызовов
    } else {
      console.error("Unknown error", error);
    }
    process.exit(1); // Завершение процесса с кодом ошибки
  }
}

process.on("uncaughtException", (err) => {
  console.error("Unhandled exception:", err);
  process.exit(1); // Завершение процесса с кодом ошибки
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled promise rejection at:", promise, "reason:", reason);
  process.exit(1); // Завершение процесса с кодом ошибки
});

main();
