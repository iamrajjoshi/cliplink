import { ConfigStore, isSensitiveKey } from "../config/store";

export async function runConfigCommand(args: string[]): Promise<void> {
  const store = new ConfigStore();

  if (args.length === 0) {
    const printable = await store.toPrintable();
    console.log(JSON.stringify(printable, null, 2));
    return;
  }

  const subcommand = args[0];

  if (subcommand === "get") {
    if (args.length < 2) {
      throw new Error("Usage: clip config get <key>");
    }
    const key = args[1];
    if (key === undefined) {
      throw new Error("Usage: clip config get <key>");
    }
    const value = await store.get(key);
    if (value === undefined) {
      console.log("");
    } else if (isSensitiveKey(key)) {
      console.log("[redacted]");
    } else if (typeof value === "object" && value !== null) {
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log(value);
    }
    return;
  }

  if (subcommand === "set") {
    if (args.length < 3) {
      throw new Error("Usage: clip config set <key> <value>");
    }
    const key = args[1];
    const value = args[2];
    if (key === undefined || value === undefined) {
      throw new Error("Usage: clip config set <key> <value>");
    }
    await store.set(key, value);
    console.log(`Set ${key} to ${value}`);
    return;
  }

  throw new Error(
    `Unknown config subcommand: "${subcommand}". Use "get <key>" or "set <key> <value>".`,
  );
}
