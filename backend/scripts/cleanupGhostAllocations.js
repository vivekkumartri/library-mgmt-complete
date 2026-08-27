/**
 * One-off cleanup: the add-student wizard's overlap-preview step used to
 * call POST /allocations with a fake studentId ('__new_student_check__')
 * just to check for scheduling conflicts — but that endpoint only skips
 * saving when there IS a conflict, so on every clean check it silently
 * created a real, permanent allocation for that made-up student. That bug
 * is fixed (the wizard now uses a true dry-run, POST /allocations/check,
 * which never persists anything), but any ghost rows it already created
 * are still sitting in your Seat_Allocations sheet, occupying seats and
 * showing up in the seat map/detail drawer as a second, garbled entry.
 *
 * This script finds every active/scheduled allocation for that fake
 * student and marks it cancelled (never hard-deletes — same as ending a
 * real allocation) so it drops out of the seat map immediately. Safe to
 * re-run; it's a no-op once there's nothing left to clean up.
 *
 * Usage: node scripts/cleanupGhostAllocations.js
 */
const repos = require('../src/repositories');

const GHOST_STUDENT_ID = '__new_student_check__';
const ACTIVE_LIKE = new Set(['scheduled', 'active']);

async function main() {
  const ghosts = await repos.allocations.findAll(
    (a) => a.student_id === GHOST_STUDENT_ID && ACTIVE_LIKE.has(a.status)
  );

  if (ghosts.length === 0) {
    console.log('No ghost allocations found — nothing to clean up.');
    return;
  }

  console.log(`Found ${ghosts.length} ghost allocation(s) — cancelling:`);
  for (const g of ghosts) {
    console.log(`  - ${g.allocation_id} (seat ${g.seat_id}, ${g.start_time}-${g.end_time})`);
    await repos.allocations.update(g.allocation_id, {
      status: 'cancelled',
      actual_end_date: new Date().toISOString().slice(0, 10),
      notes: [g.notes, 'Cancelled by cleanupGhostAllocations.js — leftover from the overlap-preview bug.'].filter(Boolean).join(' | '),
      updated_by: 'cleanup-script',
      updated_at: new Date().toISOString(),
    });
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('Cleanup failed:', err.message);
  process.exit(1);
});
