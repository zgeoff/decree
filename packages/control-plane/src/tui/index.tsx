import { render } from 'ink';
import type { Engine } from '../engine/types.ts';
import { App } from './app.tsx';

export interface RenderAppConfig {
  engine: Engine;
  repoOwner: string;
  repoName: string;
}

export interface RenderAppResult {
  waitUntilExit: () => Promise<void>;
}

export function renderApp(config: RenderAppConfig): RenderAppResult {
  const { waitUntilExit } = render(
    <App engine={config.engine} repoOwner={config.repoOwner} repoName={config.repoName} />,
  );
  return { waitUntilExit };
}
