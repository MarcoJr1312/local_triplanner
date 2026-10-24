'use client';

import { useEffect, useRef, useState } from 'react';
import { useStoreVersion } from './useStore';

export interface QueryResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[] = []): QueryResult<T> {
  const version = useStoreVersion();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const depsKey = deps.map(String).join('|');

  // Cuando cambian las dependencias (p. ej. otro trip id), se vuelve al estado de carga.
  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
  }, [depsKey]);

  // Refresco en segundo plano cuando cambia la versión del store (sin parpadeo).
  useEffect(() => {
    let alive = true;
    fetcherRef
      .current()
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, nonce, depsKey]);

  const reload = () => setNonce((n) => n + 1);

  return { data, loading, error, reload };
}
