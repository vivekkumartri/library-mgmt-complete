/**
 * One-time migration for the variable-per-row seat grid feature.
 *
 * Existing floors only have a uniform `rows` x `columns` and existing seats
 * only have a flat `seat_number` (no row/col position). This backfills:
 *   - Floors.row_config_json = an array of `columns` repeated `rows` times
 *   - Seats.row_number / Seats.col_number, derived by chunking each floor's
 *     seats (sorted by seat_number) into groups of `columns`.
 *
 * Safe to re-run — skips any floor that already has row_config_json set.
 * Usage: node scripts/migrateRowConfig.js
 */
const repos = require('../src/repositories');

async function main() {
  const floors = await repos.floors.findAll();
  for (const floor of floors) {
    if (floor.row_config_json) {
      console.log(`Skipping ${floor.floor_name} — already migrated.`);
      continue;
    }
    const rows = Number(floor.rows) || 0;
    const columns = Number(floor.columns) || 0;
    if (rows === 0 || columns === 0) {
      console.log(`Skipping ${floor.floor_name} — no rows/columns to migrate from.`);
      continue;
    }
    const rowConfig = Array(rows).fill(columns);
    await repos.floors.update(floor.floor_id, { row_config_json: JSON.stringify(rowConfig) });

    const seats = (await repos.seats.findAll((s) => s.floor_id === floor.floor_id))
      .sort((a, b) => Number(a.seat_number) - Number(b.seat_number));
    for (let i = 0; i < seats.length; i++) {
      const rowNumber = Math.floor(i / columns) + 1;
      const colNumber = (i % columns) + 1;
      await repos.seats.update(seats[i].seat_id, { row_number: rowNumber, col_number: colNumber });
    }
    console.log(`Migrated ${floor.floor_name}: rowConfig=${JSON.stringify(rowConfig)}, ${seats.length} seats stamped.`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
