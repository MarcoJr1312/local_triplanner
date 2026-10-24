// Deep link de Uber que SOLO precarga el destino (y opcionalmente el pickup).
// No solicita el viaje: la app de Uber decide con el usuario si lo pide o no.

const UBER_BASE_URL = 'https://m.uber.com/ul/?action=setPickup';

export interface UberPickup {
  latitude: number;
  longitude: number;
}

export interface UberDropoff {
  latitude: number;
  longitude: number;
}

export interface UberLinkOptions {
  title: string;
  address?: string;
  locationId?: string;
  pickup?: UberPickup;
  dropoff?: UberDropoff;
}

export function buildUberLink({ title, address, locationId, pickup, dropoff }: UberLinkOptions): string {
  const params: string[] = [];
  const nickname = title.trim();
  const destination = address?.trim() || locationId?.trim() || '';

  if (pickup) {
    params.push(`pickup[latitude]=${pickup.latitude}`);
    params.push(`pickup[longitude]=${pickup.longitude}`);
  } else {
    params.push('pickup=my_location');
  }
  if (nickname) {
    params.push(`dropoff[nickname]=${encodeURIComponent(nickname)}`);
  }
  // Coordenadas SIEMPRE que existan: sin ellas Uber a veces no coloca el
  // destino (nickname/address solos no bastan en la web móvil).
  if (dropoff) {
    params.push(`dropoff[latitude]=${dropoff.latitude}`);
    params.push(`dropoff[longitude]=${dropoff.longitude}`);
  }
  if (destination) {
    params.push(`dropoff[formatted_address]=${encodeURIComponent(destination)}`);
  }

  return `${UBER_BASE_URL}&${params.join('&')}`;
}
