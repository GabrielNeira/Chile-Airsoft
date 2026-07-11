const STORAGE_PREFIX = 'airsoft-id:onboarding';

function buildKey(userId: string, step: string): string {
  return `${STORAGE_PREFIX}:${userId}:${step}`;
}

export function getOnboardingStepFlag(userId: string | null | undefined, step: string): boolean {
  if (!userId || typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(buildKey(userId, step)) === '1';
  } catch {
    return false;
  }
}

export function setOnboardingStepFlag(userId: string | null | undefined, step: string): void {
  if (!userId || typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(buildKey(userId, step), '1');
  } catch {
    // localStorage puede no estar disponible (modo privado); no bloquea el flujo de onboarding.
  }
}
