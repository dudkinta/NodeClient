import { promises as fs } from "fs";

class ConfigLoader {
  private static instance: ConfigLoader;
  private config: any;

  private constructor(config: any) {
    this.config = config;
  }

  public static async initialize(): Promise<void> {
    if (!ConfigLoader.instance) {
      const data = await fs.readFile("./config.json", "utf-8");
      const parsedConfig = JSON.parse(data);
      ConfigLoader.instance = new ConfigLoader(parsedConfig);
    }
  }

  public static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      throw new Error(
        "ConfigLoader is not initialized. Call initialize() first."
      );
    }
    return ConfigLoader.instance;
  }

  public getConfig(): any {
    return this.config;
  }
}

export default ConfigLoader;
