export function deferEffectCleanup(
  effectGeneration: number,
  currentGeneration: () => number,
  cleanup: () => void,
): void {
  queueMicrotask(() => {
    if (currentGeneration() === effectGeneration) cleanup();
  });
}
