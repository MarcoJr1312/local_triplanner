// The GraphQL boundary must expose a stable code when the locations service is
// unavailable, without leaking transport details.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphQLError } from 'graphql';
import { guardCatalogue } from '../src/catalogue/guard.ts';
import { CatalogueUnavailableError } from '../src/catalogue/remote.ts';
import type { LocationCatalogue } from '../src/catalogue/types.ts';

function fakeCatalogue(failure?: Error): LocationCatalogue {
  const ok = async <T>(value: T): Promise<T> => {
    if (failure) throw failure;
    return value;
  };
  return {
    getById: () => ok(null),
    getByPlaceId: () => ok(null),
    getByDataId: () => ok(null),
    search: () => ok([]),
    listDestinations: () => ok([]),
    listByParent: () => ok([]),
    listPlaces: () => ok([]),
    upsert: () => ok({} as never),
    clear: () => ok(undefined),
    close: () => ok(undefined),
  };
}

describe('graphql catalogue guard', () => {
  test('maps transport failures to LOCATIONS_UNAVAILABLE', async () => {
    const guarded = guardCatalogue(fakeCatalogue(new CatalogueUnavailableError('down')));
    await assert.rejects(
      () => guarded.listDestinations(),
      (error: unknown) =>
        error instanceof GraphQLError && error.extensions.code === 'LOCATIONS_UNAVAILABLE',
    );
  });

  test('passes through successful results and unrelated errors', async () => {
    const guarded = guardCatalogue(fakeCatalogue());
    assert.deepEqual(await guarded.listDestinations(), []);

    const broken = guardCatalogue(fakeCatalogue(new Error('boom')));
    await assert.rejects(() => broken.search('x'), /boom/);
  });
});
