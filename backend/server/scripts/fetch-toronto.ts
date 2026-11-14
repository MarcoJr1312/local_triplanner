// One-time HasData ingestion for the Toronto recruiter dataset.
//
// Usage:
//   1. cp backend/.env.fetch.example backend/.env.fetch
//   2. put HASDATA_API_KEY=... in backend/.env.fetch
//   3. bun backend/server/scripts/fetch-toronto.ts
//
// The script is not part of the API runtime. It writes
// backend/db/toronto-locations.json and optional local images under
// backend/db/seed-images/. Run it again to refresh the dataset.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const DB_DIR = path.join(BACKEND_DIR, 'db');
const SEED_IMAGES_DIR = path.join(DB_DIR, 'seed-images');
const OUT_PATH = path.join(DB_DIR, 'toronto-locations.json');
const ATTR_PATH = path.join(DB_DIR, 'TORONTO_DATA.md');
const ENV_FETCH = path.join(BACKEND_DIR, '.env.fetch');

try {
  process.loadEnvFile(ENV_FETCH);
} catch {
  // The key may also come from the process environment.
}

const API_KEY = (process.env.HASDATA_API_KEY ?? '').trim();
if (!API_KEY) {
  console.error(
    'Falta HASDATA_API_KEY.\n' +
      'Copia backend/.env.fetch.example a backend/.env.fetch y completa la key.',
  );
  process.exit(1);
}

const API_BASE = 'https://api.hasdata.com/scrape/google-maps';
const TORONTO = { lat: 43.6532, lng: -79.3832 };
const MAX_PLACES = 200;
const PAGES_PER_QUERY = 2;
const PAGE_SIZE = 20;
const MAX_IMAGES = 80;
const MAX_IMAGE_BYTES = 400_000;

type Category = 'sight' | 'food' | 'activity' | 'nightlife';
type Raw = Record<string, unknown>;

interface Activity {
  id: string;
  name: string;
  category: Category;
  description: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  imageUrl: string | null;
  cost: number | null;
  tags: string[];
  durationHours: number | null;
  address: string | null;
  placeId: string | null;
  rawType: string | null;
  websiteUrl: string | null;
  phone: string | null;
  priceLevel: string | null;
}

const QUERIES: { q: string; hint: Category }[] = [
  { q: 'tourist attractions in Toronto', hint: 'sight' },
  { q: 'museums in Toronto', hint: 'sight' },
  { q: 'best restaurants in Toronto', hint: 'food' },
  { q: 'cafes in Toronto', hint: 'food' },
  { q: 'nightlife in Toronto', hint: 'nightlife' },
  { q: 'bars in Toronto', hint: 'nightlife' },
  { q: 'things to do in Toronto', hint: 'activity' },
  { q: 'parks in Toronto', hint: 'activity' },
];

function pick(obj: Raw | null | undefined, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = obj?.[key];
    if (value != null && value !== '') return value;
  }
  return undefined;
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    const found = value.find((v) => typeof v === 'string' && v.trim() !== '');
    return typeof found === 'string' ? found.trim() : null;
  }
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function toFloat(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInt(value: unknown): number | null {
  if (value == null) return null;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

const SIGHT = [
  'museum', 'gallery', 'monument', 'church', 'cathedral', 'temple', 'landmark',
  'tourist attraction', 'viewpoint', 'aquarium', 'zoo', 'historic', 'castle',
  'memorial', 'statue', 'art gallery',
];
const FOOD = [
  'restaurant', 'cafe', 'coffee', 'bakery', 'bistro', 'food', 'meal', 'pizza',
  'burger', 'sushi', 'deli', 'steak', 'seafood', 'ice cream', 'dessert', 'brunch',
  'breakfast', 'taco', 'ramen', 'noodle', 'barbecue', 'bbq', 'grill', 'kitchen',
  'eatery', 'diner', 'gastropub',
];
const NIGHTLIFE = [
  'night club', 'nightclub', 'disco', 'lounge', 'cocktail', 'karaoke', 'bar',
  'pub', 'brewery', 'dance', 'nightlife',
];

function categoryFor(raw: Raw, hint: Category): Category {
  const type = (firstString(pick(raw, ['type', 'category', 'categoryName', 'types'])) ?? '').toLowerCase();
  if (type.includes('bar') && type.includes('gastro')) return 'food';
  if (SIGHT.some((word) => type.includes(word))) return 'sight';
  if (FOOD.some((word) => type.includes(word))) return 'food';
  if (NIGHTLIFE.some((word) => type.includes(word))) return 'nightlife';
  return hint;
}

function extractResults(data: Raw): Raw[] {
  const list: Raw[] = [];
  const append = (value: unknown) => {
    if (Array.isArray(value)) list.push(...(value as Raw[]));
    else if (value && typeof value === 'object') list.push(value as Raw);
  };
  append(data.localResults);
  append(data.placeResults);
  if (list.length === 0) {
    for (const key of ['results', 'data', 'places'] as const) append(data[key]);
  }
  return list;
}

async function searchPage(q: string, start: number): Promise<Raw[]> {
  const url = new URL(`${API_BASE}/search`);
  url.searchParams.set('q', q);
  url.searchParams.set('ll', `@${TORONTO.lat},${TORONTO.lng},12z`);
  url.searchParams.set('start', String(start));
  url.searchParams.set('hl', 'en');
  url.searchParams.set('gl', 'ca');
  const res = await fetch(url, {
    headers: { 'x-api-key': API_KEY, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HasData HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return extractResults((await res.json()) as Raw);
}

function normalize(raw: Raw, hint: Category): Activity | null {
  const name = firstString(pick(raw, ['title', 'name', 'placeName', 'place name']));
  const lat = toFloat(pick(raw, ['latitude', 'lat'])) ?? toFloat((raw.gpsCoordinates as Raw | undefined)?.latitude);
  const lng = toFloat(pick(raw, ['longitude', 'lng'])) ?? toFloat((raw.gpsCoordinates as Raw | undefined)?.longitude);
  if (!name || lat == null || lng == null) return null;
  if (lat < 43.2 || lat > 44.1 || lng < -80.1 || lng > -78.8) return null;

  const placeId = firstString(pick(raw, ['placeId', 'place_id']));
  const dataId = firstString(pick(raw, ['dataId', 'data_id']));
  const baseId = placeId ?? dataId ?? `${slugify(name)}-${shortHash(`${name}:${lat}:${lng}`)}`;
  const id = `tor-${baseId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`;
  const rawType = firstString(pick(raw, ['type', 'category', 'categoryName', 'types']));
  const hours = pick(raw, ['workingHours', 'hours', 'openingHours', 'businessHours']);
  const ratingCount = toInt(
    pick(raw, ['reviews', 'reviewsCount', 'reviewCount', 'reviews_count', 'userRatingsTotal', 'ratingCount']),
  );

  return {
    id,
    name,
    category: categoryFor(raw, hint),
    description: firstString(pick(raw, ['description', 'summary', 'descriptionSnippet', 'snippet'])),
    lat,
    lng,
    rating: toFloat(pick(raw, ['rating', 'averageRating'])),
    imageUrl: firstString(pick(raw, ['imageUrl', 'image', 'thumbnail', 'photo'])),
    cost: null,
    tags: [],
    durationHours: null,
    address: firstString(pick(raw, ['address', 'formattedAddress', 'vicinity', 'fullAddress'])),
    placeId,
    rawType,
    websiteUrl: firstString(pick(raw, ['website', 'websiteUrl', 'website_url'])),
    phone: firstString(pick(raw, ['phone', 'phoneNumber', 'phone_number'])),
    priceLevel: (() => {
      const value = pick(raw, ['priceLevel', 'price_level', 'price', 'priceRange']);
      return value == null ? null : String(value);
    })(),
  };
}

async function downloadImage(url: string, id: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    const file = `${safe}.${ext}`;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return null;
    await writeFile(path.join(SEED_IMAGES_DIR, file), bytes);
    return `/uploads/seed/${file}`;
  } catch {
    return null;
  }
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function main(): Promise<void> {
  const byCategory = new Map<Category, Activity[]>();
  const seen = new Set<string>();

  for (const { q, hint } of QUERIES) {
    process.stdout.write(`  ${q} ... `);
    let found = 0;
    for (let page = 0; page < PAGES_PER_QUERY; page++) {
      const results = await searchPage(q, page * PAGE_SIZE);
      if (results.length === 0) break;
      for (const raw of results) {
        const activity = normalize(raw, hint);
        if (!activity) continue;
        const dedupeKey = activity.placeId ?? activity.id;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const list = byCategory.get(activity.category) ?? [];
        list.push(activity);
        byCategory.set(activity.category, list);
        found++;
      }
      if (results.length < PAGE_SIZE) break;
    }
    console.log(`${found} places`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const categories: Category[] = ['sight', 'food', 'activity', 'nightlife'];
  const perCategory = Math.ceil(MAX_PLACES / categories.length);
  const places = categories.flatMap((category) => (byCategory.get(category) ?? []).slice(0, perCategory));

  if (places.length < 100) {
    throw new Error(`Only ${places.length} places fetched; expected at least 100.`);
  }

  await mkdir(SEED_IMAGES_DIR, { recursive: true });
  let images = 0;
  for (const place of places) {
    if (place.imageUrl && images < MAX_IMAGES) {
      const local = await downloadImage(place.imageUrl, place.id);
      if (local) {
        place.imageUrl = local;
        images++;
      } else {
        place.imageUrl = null;
      }
    } else {
      place.imageUrl = null;
    }
  }

  const ids = new Set(places.map((place) => place.id));
  if (ids.size !== places.length) throw new Error('Duplicate place ids in the dataset.');
  const outside = places.filter((place) => distanceKm(TORONTO.lat, TORONTO.lng, place.lat, place.lng) > 100);
  if (outside.length > 0) throw new Error(`${outside.length} places are outside the Toronto area.`);

  const counts = Object.fromEntries(
    categories.map((category) => [category, places.filter((place) => place.category === category).length]),
  );

  const payload = {
    source: 'hasdata',
    city: 'Toronto',
    country: 'Canada',
    fetchedAt: new Date().toISOString(),
    query: 'Google Maps scrape via HasData',
    destinations: [
      {
        slug: 'toronto',
        name: 'Toronto',
        country: 'Canada',
        description:
          'Canada’s largest city: waterfront views, world-class museums, diverse food and a compact downtown core.',
        lat: TORONTO.lat,
        lng: TORONTO.lng,
        imageUrl: null,
        activities: places,
      },
    ],
  };

  await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await writeFile(
    ATTR_PATH,
    `# Toronto dataset\n\n` +
      `- Source: HasData Google Maps scrape (one-time fetch)\n` +
      `- Fetched: ${payload.fetchedAt}\n` +
      `- Queries: ${QUERIES.map((query) => query.q).join('; ')}\n` +
      `- Places: ${places.length} (${counts.sight} sight, ${counts.food} food, ${counts.activity} activity, ${counts.nightlife} nightlife)\n` +
      `- Images: ${images} local files under \`backend/db/seed-images/\`; others use no image.\n` +
      `- The HasData API key is not stored in this file or the dataset.\n`,
    'utf8',
  );

  console.log(`\nWrote ${OUT_PATH}`);
  console.log(`Places: ${places.length}`, counts);
  console.log(`Local images: ${images}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
