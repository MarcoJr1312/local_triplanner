import { useSyncExternalStore } from 'react';
import { getVersion, subscribe } from '../lib/api';

export function useStoreVersion(): number {
  return useSyncExternalStore(subscribe, getVersion);
}
