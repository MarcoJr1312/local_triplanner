// @ts-nocheck
import { afterEach, describe, expect, test } from 'bun:test';
import {
  GEOLOCATION_ERROR_KEYS,
  getCurrentLocation,
  getLastGeolocationError,
} from './geolocation';

const originalNavigator = globalThis.navigator;

function setGeolocation(geolocation: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { geolocation },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
    writable: true,
  });
});

describe('getCurrentLocation', () => {
  test('sin navigator.geolocation devuelve null y code unavailable', async () => {
    setGeolocation(undefined);

    expect(await getCurrentLocation()).toBeNull();
    expect(getLastGeolocationError()).toBe('unavailable');
  });

  test('resuelve coordenadas con las opciones esperadas', async () => {
    let options: PositionOptions | undefined;
    setGeolocation({
      getCurrentPosition: (success, _error, opts) => {
        options = opts;
        success({ coords: { latitude: 1.5, longitude: -2.5 } });
      },
    });

    expect(await getCurrentLocation()).toEqual({ latitude: 1.5, longitude: -2.5 });
    expect(getLastGeolocationError()).toBeNull();
    expect(options).toEqual({
      enableHighAccuracy: true,
      maximumAge: 30000,
      timeout: 10000,
    });
  });

  for (const [code, expected] of [
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
    [9, 'generic'],
  ] as const) {
    test(`mapea el error ${code} a ${expected}`, async () => {
      setGeolocation({
        getCurrentPosition: (_success, error) => error({ code }),
      });

      expect(await getCurrentLocation()).toBeNull();
      expect(getLastGeolocationError()).toBe(expected);
    });
  }
});

describe('GEOLOCATION_ERROR_KEYS', () => {
  test('cubre todos los códigos', () => {
    expect(Object.keys(GEOLOCATION_ERROR_KEYS).sort()).toEqual([
      'denied',
      'generic',
      'timeout',
      'unavailable',
    ]);
  });
});
