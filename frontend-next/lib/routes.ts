// Construccion de rutas multi-destino para Google Maps.
// Sin APIs/keys de Google: solo la URL publica /dir/ (como el preview de PDF).

export type RouteStop = { lat: number; lng: number } | { text: string };

// Tope de paradas soportado por la URL (Google Maps limita waypoints; URLs
// muy largas se truncan en navegadores).
export const MAX_ROUTE_STOPS = 10;

// Segmento de la URL para una parada: coordenadas o texto libre (direccion
// escrita por el usuario para actividades sin lugar vinculado).
export function segment(stop: RouteStop): string {
  if ('text' in stop) return encodeURIComponent(stop.text);
  return `${stop.lat},${stop.lng}`;
}

// https://www.google.com/maps/dir//<parada1>/<parada2>...
// Si hay originText (direccion dada por el usuario en el popup), va como
// PRIMER segmento encodeURIComponent. Si no hay, el ORIGEN queda VACIO a
// proposito (doble barra tras /dir/): Google Maps muestra "Elige punto de
// partida" y el usuario escribe su direccion/hotel.
export function buildGoogleMapsRouteUrl(stops: RouteStop[], originText?: string | null): string {
  const parts = stops.map(segment);
  if (originText) {
    return `https://www.google.com/maps/dir/${encodeURIComponent(originText)}/${parts.join('/')}`;
  }
  return `https://www.google.com/maps/dir//${parts.join('/')}`;
}
