// TODO: Wire v2 engine (createEngineV2) with config loader (loadConfig).
// The old createEngine returns the v1 Engine interface, but the TUI now expects
// the v2 Engine interface. A config adapter bridging ResolvedEngineConfig to
// v2 EngineConfig is needed.
async function main(): Promise<void> {
  // Not yet wired — see TODO above
}

export {};

await main();
