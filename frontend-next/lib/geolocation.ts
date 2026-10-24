// Geolocalización del navegador con errores tipados.
// Solo debe invocarse tras un clic explícito del usuario: nunca al montar.

import type { TranslationKey } from './i18n';

export type GeolocationErrorCode = 'denied' | 'unavailable' | 'timeout' | 'generic';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

let lastError: GeolocationErrorCode | null = null;

export function getLastGeolocationError(): GeolocationErrorCode | null {
  return lastError;
}

export const GEOLOCATION_ERROR_KEYS: Record<GeolocationErrorCode, TranslationKey> = {
  denied: 'geolocation.denied',
  unavailable: 'geolocation.unavailable',
  timeout: 'geolocation.timeout',
  generic: 'geolocation.generic',
};

export async function getCurrentLocation(): Promise<Coordinates | null> {
  lastError = null;

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    lastError = 'unavailable';
    return null;
  }

  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        (error) => {
          lastError =
            error.code === 1
              ? 'denied'
              : error.code === 2
                ? 'unavailable'
                : error.code === 3
                  ? 'timeout'
                  : 'generic';
          resolve(null);
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
      );
    } catch {
      lastError = 'generic';
      resolve(null);
    }
  });
}
