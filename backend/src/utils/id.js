const { v4: uuidv4 } = require('uuid');

function uuid() {
  return uuidv4();
}

/**
 * Generates a sequential, human-readable ID like LIB-2026-0042.
 * `existingIds` should be every id already used with this prefix+year so we
 * can find the next free sequence number without relying on row counts
 * (which would break once records are deleted/archived).
 */
function nextSequentialId(prefix, year, existingIds) {
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  let max = 0;
  for (const id of existingIds) {
    const m = pattern.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const next = String(max + 1).padStart(4, '0');
  return `${prefix}-${year}-${next}`;
}

module.exports = { uuid, nextSequentialId };
