// The standalone scorecard page URL for a plan. Opening it lands directly on the
// report card (route '/scorecard' in App), no in-app clicks needed.
export function scorecardUrl(planId: string): string {
  return `${window.location.origin}/scorecard?plan=${encodeURIComponent(planId)}`;
}

// The plan id from the current /scorecard URL, or null.
export function scorecardPlanIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('plan');
}
