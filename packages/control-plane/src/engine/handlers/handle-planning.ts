import { match } from 'ts-pattern';
import { getSpecsRequiringPlanning } from '../state-store/selectors/get-specs-requiring-planning.ts';
import type {
  EngineCommand,
  EngineEvent,
  EngineState,
  RequestPlannerRun,
} from '../state-store/types.ts';

export function handlePlanning(event: EngineEvent, state: EngineState): EngineCommand[] {
  return match(event)
    .with({ type: 'specChanged' }, (e) => {
      if (e.frontmatterStatus !== 'approved') {
        return [];
      }

      if (getSpecsRequiringPlanning(state).length === 0) {
        return [];
      }

      return [buildRequestPlannerRun(state)];
    })
    .with({ type: 'plannerCompleted' }, (e) => {
      const commands: EngineCommand[] = [{ command: 'applyPlannerResult', result: e.result }];

      if (getSpecsRequiringPlanning(state).length > 0) {
        commands.push(buildRequestPlannerRun(state));
      }

      return commands;
    })
    .otherwise(() => []);
}

function buildRequestPlannerRun(state: EngineState): RequestPlannerRun {
  return {
    command: 'requestPlannerRun',
    specPaths: collectApprovedSpecPaths(state),
  };
}

function collectApprovedSpecPaths(state: EngineState): string[] {
  const paths: string[] = [];

  for (const spec of state.specs.values()) {
    if (spec.frontmatterStatus === 'approved') {
      paths.push(spec.filePath);
    }
  }

  return paths;
}
