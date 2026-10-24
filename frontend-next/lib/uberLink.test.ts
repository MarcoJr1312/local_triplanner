// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import { buildUberLink } from './uberLink';

const BASE = 'https://m.uber.com/ul/?action=setPickup&pickup=my_location';

describe('buildUberLink', () => {
  test('incluye la base y precarga nickname + dirección', () => {
    const url = buildUberLink({
      title: 'Torre Eiffel',
      address: 'Champ de Mars, 5 Av. Anatole France, 75007 París',
    });

    expect(url).toBe(
      `${BASE}&dropoff[nickname]=Torre%20Eiffel&dropoff[formatted_address]=Champ%20de%20Mars%2C%205%20Av.%20Anatole%20France%2C%2075007%20Par%C3%ADs`
    );
    expect(url.startsWith(BASE)).toBe(true);
    expect(url.includes('action=setPickup')).toBe(true);
  });

  test('encodea espacios y tildes del título', () => {
    const url = buildUberLink({ title: 'Café de Flore & Musée' });

    expect(url).toContain('dropoff[nickname]=Caf%C3%A9%20de%20Flore%20%26%20Mus%C3%A9e');
  });

  test('sin dirección usa el locationId como formatted_address', () => {
    const url = buildUberLink({ title: 'Cena', locationId: 'pan-casacasco' });

    expect(url).toContain('dropoff[formatted_address]=pan-casacasco');
  });

  test('sin título ni location devuelve solo la base (sin nickname)', () => {
    const url = buildUberLink({ title: '   ' });

    expect(url).toBe(BASE);
    expect(url.includes('dropoff[nickname]')).toBe(false);
    expect(url.includes('dropoff[formatted_address]')).toBe(false);
  });

  test('con pickup usa las coordenadas y no my_location', () => {
    const url = buildUberLink({
      title: 'Cena',
      pickup: { latitude: -34.603722, longitude: -58.381592 },
    });

    expect(url).toContain('pickup[latitude]=-34.603722');
    expect(url).toContain('pickup[longitude]=-58.381592');
    expect(url.includes('pickup=my_location')).toBe(false);
  });

  test('sin pickup conserva pickup=my_location', () => {
    const url = buildUberLink({ title: 'Cena' });

    expect(url.includes('pickup=my_location')).toBe(true);
    expect(url.includes('pickup[latitude]')).toBe(false);
    expect(url.startsWith(`${BASE}&dropoff[nickname]=Cena`)).toBe(true);
  });

  test('con dropoff usa dropoff[latitude]/[longitude]', () => {
    const url = buildUberLink({
      title: 'Nación Sushi',
      address: 'Plaza, Av. Manuel Espinosa Batista',
      dropoff: { latitude: 8.9772981, longitude: -79.5177126 },
    });

    expect(url).toContain('dropoff[latitude]=8.9772981');
    expect(url).toContain('dropoff[longitude]=-79.5177126');
    expect(url).toContain('dropoff[nickname]=Naci%C3%B3n%20Sushi');
    expect(url).toContain('pickup=my_location');
  });

  test('sin dropoff no emite parámetros de coordenadas de destino', () => {
    const url = buildUberLink({ title: 'Cena' });

    expect(url.includes('dropoff[latitude]')).toBe(false);
    expect(url.includes('dropoff[longitude]')).toBe(false);
  });

  test('no contiene ninguna acción de solicitud de viaje', () => {
    const url = buildUberLink({ title: 'Museo', address: 'Calle 1' });

    expect(url.includes('action=setPickup')).toBe(true);
    expect(url.includes('request')).toBe(false);
  });
});
