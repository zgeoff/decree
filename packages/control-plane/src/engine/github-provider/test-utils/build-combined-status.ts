interface CombinedStatusData {
  state: string;
  total_count: number;
}

export function buildCombinedStatus(state: string, totalCount: number): CombinedStatusData {
  return { state, total_count: totalCount };
}
