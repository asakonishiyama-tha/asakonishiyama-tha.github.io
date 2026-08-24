import { useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";

export const sceneReveal = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
};

const subscribeToHydration = () => () => undefined;

export function useHydrationSafeReducedMotion() {
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const prefersReducedMotion = useReducedMotion();
  return hydrated && Boolean(prefersReducedMotion);
}

export function getSceneRevealProps(reducedMotion: boolean | null) {
  return reducedMotion ? undefined : sceneReveal;
}
