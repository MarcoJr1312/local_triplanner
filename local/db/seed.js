// Seed idempotente para la base SQLite local.
// - Aplica local/db/schema.sql
// - Importa destinos + actividades desde backend/seed/data.json (source='seed', parent_id -> destino)
// - Crea usuario demo + trip demo para arrancar con datos
// Idempotente: INSERT OR IGNORE; re-ejecutar no duplica.

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'triplanner.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const SEED_DATA_PATH = path.resolve(__dirname, '..', '..', 'backend', 'seed', 'data.json');

const now = () => new Date().toISOString();

function main() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const seed = JSON.parse(fs.readFileSync(SEED_DATA_PATH, 'utf8'));

  const db = new DatabaseSync(DB_PATH);
  db.exec(schema);

  seedLocations(db, seed);
  seedDemo(db);

  const { destinations, activities } = count(db);
  console.log(`Seed OK — ${destinations} destinos, ${activities} actividades en ${DB_PATH}`);
  db.close();
}

function seedLocations(db, seed) {
  const insertLoc = db.prepare(`
    INSERT OR IGNORE INTO locations
      (id, source, place_id, data_id, slug, name, category, raw_type, country, description,
       lat, lng, address, rating, rating_count, hours_json, website_url, social_links_json,
       phone, price_level, image_url, cost, tags_json, duration_hours, parent_id, last_updated)
    VALUES
      (:id, :source, :place_id, :data_id, :slug, :name, :category, :raw_type, :country, :description,
       :lat, :lng, :address, :rating, :rating_count, :hours_json, :website_url, :social_links_json,
       :phone, :price_level, :image_url, :cost, :tags_json, :duration_hours, :parent_id, :last_updated)
  `);
  const insertFts = db.prepare(`
    INSERT INTO locations_fts (location_id, name, description) VALUES (?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    for (const dest of seed.destinations) {
      const d = {
        id: dest.slug,
        source: 'seed',
        place_id: null,
        data_id: null,
        slug: dest.slug,
        name: dest.name,
        category: null,
        raw_type: null,
        country: dest.country,
        description: dest.description,
        lat: dest.lat,
        lng: dest.lng,
        address: null,
        rating: null,
        rating_count: null,
        hours_json: null,
        website_url: null,
        social_links_json: null,
        phone: null,
        price_level: null,
        image_url: dest.imageUrl ?? null,
        cost: null,
        tags_json: null,
        duration_hours: null,
        parent_id: null,
        last_updated: now(),
      };
      const res = insertLoc.run(d);
      if (res.changes > 0) insertFts.run(d.id, d.name, d.description ?? null);

      for (const a of dest.activities ?? []) {
        const loc = {
          id: a.id,
          source: 'seed',
          place_id: null,
          data_id: null,
          slug: null,
          name: a.name,
          category: a.category,
          raw_type: null,
          country: null,
          description: a.description,
          lat: a.lat,
          lng: a.lng,
          address: null,
          rating: a.rating ?? null,
          rating_count: null,
          hours_json: null,
          website_url: null,
          social_links_json: null,
          phone: null,
          price_level: null,
          image_url: a.imageUrl ?? null,
          cost: a.cost ?? null,
          tags_json: a.tags ? JSON.stringify(a.tags) : null,
          duration_hours: a.durationHours ?? null,
          parent_id: dest.slug,
          last_updated: now(),
        };
        const ar = insertLoc.run(loc);
        if (ar.changes > 0) insertFts.run(loc.id, loc.name, loc.description ?? null);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function seedDemo(db) {
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, email, display_name, color) VALUES (?, ?, ?, ?)
  `);
  const insertTrip = db.prepare(`
    INSERT OR IGNORE INTO trips
      (id, name, destination_id, destination_name, start_date, end_date, total_budget, owner_id, invite_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO trip_members (trip_id, user_id, role) VALUES (?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO trip_items
      (id, trip_id, location_id, title, category, cost, day, "order", created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    insertUser.run('demo-user', 'demo@triplanner.local', 'Demo', '#6366f1');
    insertTrip.run(
      'demo-trip', 'Fin de semana en Toronto', 'toronto', 'Toronto',
      '2026-11-06', '2026-11-08', 1200, 'demo-user', 'DEMO123'
    );
    insertMember.run('demo-trip', 'demo-user', 'owner');
    insertItem.run('demo-item-1', 'demo-trip', 'tor-cn-tower', 'CN Tower', 'sight', 43, '2026-11-06', 0, 'demo-user');
    insertItem.run('demo-item-2', 'demo-trip', 'tor-alo', 'Alo Restaurant', 'food', 110, '2026-11-07', 0, 'demo-user');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function count(db) {
  const destinations = db.prepare(
    `SELECT COUNT(*) c FROM locations WHERE slug IS NOT NULL`
  ).get().c;
  const activities = db.prepare(
    `SELECT COUNT(*) c FROM locations WHERE parent_id IS NOT NULL`
  ).get().c;
  return { destinations, activities };
}

main();
