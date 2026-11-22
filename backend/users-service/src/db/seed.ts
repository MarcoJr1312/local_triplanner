// Protected demo identities. Fixed UUIDs are part of the contract: the trips
// seed and existing references use them, and the API rejects deleting them.
// Passwords are hashed with Argon2id and only the login hint shows the plain
// value (`demo123`).

import { connect, type Db } from '../db.ts';
import { loadConfig, loadDotEnv } from '../env.ts';

export const DEMO_USER_UUID = '11111111-1111-4111-8111-111111111111';
export const DEMO_FRIEND_UUID = '22222222-2222-4222-8222-222222222222';
export const DEMO_PASSWORD = 'demo123';

export interface DemoUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  color: string;
  password: string;
}

export const DEMO_USERS: readonly DemoUser[] = [
  {
    id: DEMO_USER_UUID,
    username: 'demo',
    email: 'demo@triplanner.local',
    displayName: 'Demo',
    color: '#6366f1',
    password: DEMO_PASSWORD,
  },
  {
    id: DEMO_FRIEND_UUID,
    username: 'demo-friend',
    email: 'friend@triplanner.local',
    displayName: 'Demo Friend',
    color: '#10b981',
    password: DEMO_PASSWORD,
  },
];

export const DEMO_UUIDS: readonly string[] = [DEMO_USER_UUID, DEMO_FRIEND_UUID];

export function isProtectedUserId(id: string): boolean {
  return DEMO_UUIDS.includes(id);
}

export interface SeedResult {
  /** Accounts inserted by this run; 0 when the seed already ran. */
  created: number;
  total: number;
}

export async function seedDemoUsers(db: Db): Promise<SeedResult> {
  const existing = await db.query<{ username: string }>(
    `SELECT lower(username) AS username
       FROM users
      WHERE lower(username) = ANY($1::text[])`,
    [DEMO_USERS.map((user) => user.username)],
  );
  const present = new Set(existing.map((row) => row.username));
  const missing = DEMO_USERS.filter((user) => !present.has(user.username));

  // Hash only when a row is missing: argon2 is deliberately expensive.
  const hashes = new Map<string, string>();
  for (const user of missing) {
    hashes.set(user.username, await Bun.password.hash(user.password, { algorithm: 'argon2id' }));
  }

  let created = 0;
  await db.transaction(async (tx) => {
    for (const user of missing) {
      const hash = hashes.get(user.username);
      if (!hash) continue;
      created += await tx.run(
        `INSERT INTO users (id, username, email, password_hash, display_name, color, language)
         VALUES ($1, $2, $3, $4, $5, $6, 'es')
         ON CONFLICT DO NOTHING`,
        [user.id, user.username, user.email, hash, user.displayName, user.color],
      );
    }
  });

  return { created, total: DEMO_USERS.length };
}

if (import.meta.main) {
  loadDotEnv();
  const config = loadConfig();
  const db = await connect(config);
  try {
    const result = await seedDemoUsers(db);
    console.log(`[users] demo seed: ${result.created} created, ${result.total} protected accounts`);
  } finally {
    await db.close();
  }
}
