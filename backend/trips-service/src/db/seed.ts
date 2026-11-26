// Demo trip seed. The API owns demo users; the trips service owns the trip,
// its owner membership and its nine items. No user rows are created here.
//
// The picks mirror the API seed (3 sight, 3 food, 2 activity, 1 nightlife)
// with stable ids, so local and remote modes display the same demo trip.

import { connect, type Db } from '../db.ts';
import { loadConfig, loadDotEnv } from '../env.ts';

export const DEMO_TRIP_ID = 'demo-trip';
// Fixed demo UUID from the users service (M10.10).
export const DEMO_OWNER_ID = '11111111-1111-4111-8111-111111111111';

interface DemoItem {
  id: string;
  locationId: string;
  title: string;
  category: string;
  cost: number;
  day: string;
  order: number;
  startTime: string;
}

const DAYS = ['2026-12-04', '2026-12-05', '2026-12-06'] as const;

const PICKS = [
  { locationId: 'tor-cn-tower', title: 'CN Tower', category: 'sight', cost: 43 },
  { locationId: 'tor-ripleys', title: "Ripley's Aquarium of Canada", category: 'sight', cost: 44 },
  { locationId: 'tor-rom', title: 'Royal Ontario Museum', category: 'sight', cost: 26 },
  { locationId: 'tor-st-lawrence', title: 'St. Lawrence Market', category: 'food', cost: 20 },
  { locationId: 'tor-chinatown', title: 'Chinatown', category: 'food', cost: 15 },
  { locationId: 'tor-little-italy', title: 'Little Italy', category: 'food', cost: 20 },
  { locationId: 'tor-edgewalk', title: 'CN Tower EdgeWalk', category: 'activity', cost: 225 },
  { locationId: 'tor-kensington', title: 'Kensington Market', category: 'activity', cost: 0 },
  { locationId: 'tor-bar-raval', title: 'Bar Raval', category: 'nightlife', cost: 20 },
];

const START_TIMES = [
  '10:00',
  '14:00',
  '19:00',
  '09:30',
  '13:00',
  '20:00',
  '11:00',
  '15:30',
  '21:00',
];

export const DEMO_ITEMS: DemoItem[] = PICKS.map((pick, index) => ({
  id: `demo-item-${index + 1}`,
  ...pick,
  day: DAYS[Math.min(Math.floor(index / 3), DAYS.length - 1)] ?? DAYS[0],
  order: index % 3,
  startTime: START_TIMES[index] ?? '10:00',
}));

export interface SeedResult {
  tripId: string;
  items: number;
}

export async function seedDemo(db: Db): Promise<SeedResult> {
  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO trips
         (id, name, destination_id, destination_name, destination_lat, destination_lng,
          start_date, end_date, total_budget, timezone, owner_id, invite_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT DO NOTHING`,
      [
        DEMO_TRIP_ID,
        'Weekend in Toronto',
        'toronto',
        'Toronto',
        43.6532,
        -79.3832,
        '2026-12-04',
        '2026-12-06',
        1200,
        'America/Toronto',
        DEMO_OWNER_ID,
        'DEMO123',
      ],
    );

    await tx.run(
      `INSERT INTO trip_members (trip_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT DO NOTHING`,
      [DEMO_TRIP_ID, DEMO_OWNER_ID],
    );

    for (const item of DEMO_ITEMS) {
      await tx.run(
        `INSERT INTO trip_items
           (id, trip_id, location_id, title, category, cost, day, "order", start_time, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT DO NOTHING`,
        [
          item.id,
          DEMO_TRIP_ID,
          item.locationId,
          item.title,
          item.category,
          item.cost,
          item.day,
          item.order,
          item.startTime,
          DEMO_OWNER_ID,
        ],
      );
    }
  });

  return { tripId: DEMO_TRIP_ID, items: DEMO_ITEMS.length };
}

if (import.meta.main) {
  loadDotEnv();
  const config = loadConfig();
  const db = await connect(config);
  try {
    const result = await seedDemo(db);
    console.log(`[trips] seeded ${result.items} items into ${result.tripId}`);
  } finally {
    await db.close();
  }
}
