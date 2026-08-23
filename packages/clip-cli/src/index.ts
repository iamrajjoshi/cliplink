#!/usr/bin/env node

import { routeCommand } from "./commands";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  await routeCommand(args);
}
