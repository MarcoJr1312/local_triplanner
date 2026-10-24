// Cliente HTTP de HasData (Google Maps scrape).
// - Header x-api-key; la key viene de env y NUNCA se imprime/loguea.
// - fetch inyectable para poder mockear en tests (sin gastar creditos).

const HASDATA_BASE_URL = 'https://api.hasdata.com/scrape/google-maps';

export interface HasDataClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface HasDataSearchOptions {
  lat?: number | null;
  lng?: number | null;
  start?: number;
  hl?: string;
  gl?: string;
  zoom?: number;
}

export interface HasDataResponse {
  status?: string;
  error?: string;
  localResults?: unknown[];
  placeResults?: unknown[];
  results?: unknown[];
  [key: string]: unknown;
}

export class HasDataClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HasDataClientOptions) {
    const { apiKey, baseUrl = HASDATA_BASE_URL, fetchImpl = fetch } = options;
    if (!apiKey) throw new Error('HasDataClient: apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  // GET /scrape/google-maps/search  (q requerido; opcionales ll, start, hl, gl)
  async search(q: string, { lat, lng, start = 0, hl, gl, zoom = 14 }: HasDataSearchOptions = {}): Promise<HasDataResponse> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', q);
    // Formato de HasData: @lat,lng,zoom (ej: @40.7455,-74.0083,14z) — el zoom va DENTRO de ll
    if (lat != null && lng != null) url.searchParams.set('ll', `@${lat},${lng},${zoom}z`);
    if (start != null) url.searchParams.set('start', String(start));
    if (hl) url.searchParams.set('hl', hl);
    if (gl) url.searchParams.set('gl', gl);
    return this._get(url);
  }

  // GET /scrape/google-maps/place  (placeId; dataId NO es placeId)
  async place(placeId: string, { fetchWebResults = false }: { fetchWebResults?: boolean } = {}): Promise<HasDataResponse> {
    const url = new URL(`${this.baseUrl}/place`);
    url.searchParams.set('placeId', placeId);
    if (fetchWebResults) url.searchParams.set('fetchWebResults', 'true');
    return this._get(url);
  }

  private async _get(url: URL): Promise<HasDataResponse> {
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`HasData HTTP ${res.status}`);
    }
    return (await res.json()) as HasDataResponse;
  }
}
