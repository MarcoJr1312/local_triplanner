// Replays one outbox row by id. The relay republishes it on the next tick; the
// email service deduplicates by event id.

import { connect } from '../db.ts';
import { resetOutbox } from '../domain/store.ts';
import { loadConfig, loadDotEnv } from '../env.ts';

loadDotEnv();

const id = process.argv[2]?.trim();
if (!id) {
  console.error('usage: bun src/db/replay-outbox.ts <outbox-id>');
  process.exit(1);
}

const config = loadConfig();
const db = await connect(config);

try {
  const reset = await resetOutbox(db, id);
  if (!reset) {
    console.error(`[trips] outbox ${id} not found`);
    process.exitCode = 1;
  } else {
    console.log(`[trips] outbox ${id} reset; the relay will republish it`);
  }
} finally {
  await db.close();
}
