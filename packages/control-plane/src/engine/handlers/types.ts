import type { EngineCommand, EngineEvent, EngineState } from '../state-store/types.ts';

export type Handler = (event: EngineEvent, state: EngineState) => EngineCommand[];
