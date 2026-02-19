import { resolve } from 'node:path';
import { createEngine } from './engine/create-engine.ts';
import type { AppConfig, Engine } from './engine/types.ts';
import type { RenderAppResult } from './tui/index.tsx';
import { renderApp } from './tui/index.tsx';

const configPath: string = resolve('control-plane.config.ts');
const configModule: { default: AppConfig } = await import(configPath);
const config: AppConfig = configModule.default;

const engine: Engine = createEngine(config);
const app: RenderAppResult = renderApp({
  engine,
  repoOwner: config.repoOwner,
  repoName: config.repoName,
});
await app.waitUntilExit();
await engine.stop();
