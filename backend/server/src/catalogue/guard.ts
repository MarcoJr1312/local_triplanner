// Envuelve el catalogo para que un fallo del servicio remoto llegue a GraphQL
// con un codigo estable, sin filtrar la URL ni el token.

import { GraphQLError } from 'graphql';
import type { LocationCatalogue } from './types.ts';
import { CatalogueUnavailableError } from './remote.ts';

function unavailable(): GraphQLError {
  return new GraphQLError('El catálogo de lugares no está disponible.', {
    extensions: { code: 'LOCATIONS_UNAVAILABLE' },
  });
}

function guard<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof CatalogueUnavailableError) throw unavailable();
      throw error;
    }
  };
}

export function guardCatalogue(catalogue: LocationCatalogue): LocationCatalogue {
  return {
    getById: guard(catalogue.getById.bind(catalogue)),
    getByPlaceId: guard(catalogue.getByPlaceId.bind(catalogue)),
    getByDataId: guard(catalogue.getByDataId.bind(catalogue)),
    search: guard(catalogue.search.bind(catalogue)),
    listDestinations: guard(catalogue.listDestinations.bind(catalogue)),
    listByParent: guard(catalogue.listByParent.bind(catalogue)),
    listPlaces: guard(catalogue.listPlaces.bind(catalogue)),
    upsert: guard(catalogue.upsert.bind(catalogue)),
    clear: guard(catalogue.clear.bind(catalogue)),
    close: guard(catalogue.close.bind(catalogue)),
  };
}
