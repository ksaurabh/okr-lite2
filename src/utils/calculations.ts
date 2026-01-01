import type { Objective, KeyResult, ObjectiveStatus } from '../types';

export function calculateKeyResultProgress(kr: KeyResult): number {
  if (kr.targetValue === 0) return 0;
  const progress = (kr.currentValue / kr.targetValue) * 100;
  return Math.min(100, Math.max(0, Math.round(progress)));
}

export function calculateObjectiveProgress(
  objective: Objective,
  keyResults: KeyResult[],
  allObjectives: Objective[]
): number {
  const ownKeyResults = keyResults.filter(kr => kr.objectiveId === objective.id);
  const childObjectives = allObjectives.filter(o => o.parentId === objective.id);

  const krProgresses = ownKeyResults.map(kr => calculateKeyResultProgress(kr));
  const childProgresses = childObjectives.map(child =>
    calculateObjectiveProgress(child, keyResults, allObjectives)
  );

  const allProgresses = [...krProgresses, ...childProgresses];

  if (allProgresses.length === 0) return 0;

  const sum = allProgresses.reduce((acc, p) => acc + p, 0);
  return Math.round(sum / allProgresses.length);
}

export function determineStatus(progress: number): ObjectiveStatus {
  if (progress >= 70) return 'on-track';
  if (progress >= 40) return 'at-risk';
  return 'behind';
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function getStatusColor(status: ObjectiveStatus): string {
  switch (status) {
    case 'on-track': return 'text-green-600 bg-green-100';
    case 'at-risk': return 'text-yellow-600 bg-yellow-100';
    case 'behind': return 'text-red-600 bg-red-100';
  }
}

export function getProgressColor(progress: number): string {
  if (progress >= 70) return 'bg-green-500';
  if (progress >= 40) return 'bg-yellow-500';
  return 'bg-red-500';
}
