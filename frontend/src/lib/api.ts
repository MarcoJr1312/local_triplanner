import { getMode } from './config';
import type { DataMode } from './config';
import { mockApi } from './mockApi';
import { realApi, searchLocations as localSearchLocations, locationDetails as localLocationDetails, locationById as localLocationById } from './realApi';
import type { Location, TriplannerApi } from './types';

export type { TriplannerApi };
export type { DataMode } from './config';

export const mode: DataMode = getMode();

export const api: TriplannerApi = mode === 'mock' ? mockApi : realApi;

export function isLocalMode(): boolean {
  return mode === 'local';
}

/**
 * Búsqueda de lugares contra el backend local (FTS5 + HasData).
 * En modos mock/aws devuelve lista vacía (la UI no la usa fuera del modo local).
 */
export function searchLocations(q: string, lat?: number, lng?: number): Promise<Location[]> {
  if (mode !== 'local') return Promise.resolve([]);
  return localSearchLocations(q, lat, lng);
}

/**
 * Detalle de un lugar (horarios, web, redes sociales) contra el backend local.
 * Cache-first en el servidor: solo llama a HasData si falta detalle.
 */
export function locationDetails(placeId: string): Promise<Location | null> {
  if (mode !== 'local') return Promise.resolve(null);
  return localLocationDetails(placeId);
}

/**
 * Informacion completa de un lugar por su id (para el modal de detalle de un
 * item guardado). Solo en modo local.
 */
export function locationById(id: string): Promise<Location | null> {
  if (mode !== 'local') return Promise.resolve(null);
  return localLocationById(id);
}

export function subscribe(listener: () => void): () => void {
  return api.subscribe(listener);
}

export function getVersion(): number {
  return api.getVersion();
}
