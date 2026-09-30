import type { EventSubscription } from 'expo-modules-core';
import { useEffect, useRef, useState } from 'react';

import type {
  AccessRestrictionEvent,
  AlertSignRef,
  BuildupAreaEvent,
  SignsEvent,
  StopRestrictionEvent,
} from './MapZoneSpeedAlert.types';
import MapZoneSpeedAlertModule from './MapZoneSpeedAlertModule';

const subscribeSigns = (listener: (event: SignsEvent) => void) =>
  MapZoneSpeedAlertModule.addListener('onSigns', listener);
const subscribeAccessRestriction = (listener: (event: AccessRestrictionEvent) => void) =>
  MapZoneSpeedAlertModule.addListener('onAccessRestriction', listener);
const subscribeStopRestriction = (listener: (event: StopRestrictionEvent) => void) =>
  MapZoneSpeedAlertModule.addListener('onStopRestriction', listener);
const subscribeBuildupArea = (listener: (event: BuildupAreaEvent) => void) =>
  MapZoneSpeedAlertModule.addListener('onBuildupArea', listener);

// Module-level constants keep the effect deps stable.
const SIGN_SLOTS: (keyof SignsEvent)[] = ['current', 'next', 'camera', 'toll'];
const RESTRICTION_SLOTS: 'image'[] = ['image'];

function releaseAll<T>(event: T, slots: (keyof T)[]) {
  for (const slot of slots) {
    (event[slot] as AlertSignRef | null)?.release();
  }
}

/**
 * Keeps one event kind in state and releases the native image refs of every
 * delivered event once React has committed a newer one. Events that arrive
 * between two commits (batched) never become state, so they are tracked in a
 * ref and released together with the committed predecessor.
 */
function useLatestEvent<T>(
  subscribe: (listener: (event: T) => void) => EventSubscription,
  slots: (keyof T)[]
): T | null {
  const [current, setCurrent] = useState<T | null>(null);
  const pending = useRef<T[]>([]);

  useEffect(() => {
    const subscription = subscribe((event) => {
      pending.current.push(event);
      setCurrent(event);
    });
    return () => subscription.remove();
  }, [subscribe]);

  // Runs after each commit: everything delivered *before* the committed value
  // is stale and is released exactly once here. Anything after it (an event
  // that landed between the commit and this effect) is left alone — it is
  // about to become `current` itself.
  useEffect(() => {
    if (!current) return;
    const index = pending.current.indexOf(current);
    if (index <= 0) return;
    pending.current.splice(0, index).forEach((event) => releaseAll(event, slots));
  }, [current, slots]);

  // Unmount only (the subscription above is already removed by then): release
  // the committed value plus anything that arrived after the last commit.
  useEffect(
    () => () => {
      pending.current.forEach((event) => releaseAll(event, slots));
      pending.current = [];
    },
    [slots]
  );

  return current;
}

/**
 * Latest sign tick plus the latest state of each restriction group.
 * Restriction groups only change occasionally; mounting while one is active
 * still shows it because the first subscriber receives a replay of the
 * current state. A group whose `kind` is 0 has `image === null` — hide it.
 */
export function useSpeedAlertSigns(): {
  signs: SignsEvent | null;
  accessRestriction: AccessRestrictionEvent | null;
  stopRestriction: StopRestrictionEvent | null;
  buildupArea: BuildupAreaEvent | null;
} {
  const signs = useLatestEvent<SignsEvent>(subscribeSigns, SIGN_SLOTS);
  const accessRestriction = useLatestEvent<AccessRestrictionEvent>(
    subscribeAccessRestriction,
    RESTRICTION_SLOTS
  );
  const stopRestriction = useLatestEvent<StopRestrictionEvent>(
    subscribeStopRestriction,
    RESTRICTION_SLOTS
  );
  const buildupArea = useLatestEvent<BuildupAreaEvent>(subscribeBuildupArea, RESTRICTION_SLOTS);
  return { signs, accessRestriction, stopRestriction, buildupArea };
}
