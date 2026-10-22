import * as XLSX from 'xlsx';

/**
 * Shared CSV/Excel export helper (spec section 33). `rows` is an array of
 * flat objects; `columns` is [[key, header], ...] controlling column order
 * and labels. Used by every report section in Reports.jsx so all exports
 * behave identically.
 */
function toAoa(rows, columns) {
  const header = columns.map(([, label]) => label);
  const body = rows.map((row) => columns.map(([key]) => row[key] ?? ''));
  return [header, ...body];
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(rows, columns, filename) {
  const aoa = toAoa(rows, columns);
  const csv = aoa
    .map((r) => r.map((cell) => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv' }), filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export function exportXlsx(rows, columns, filename, sheetName = 'Report') {
  const aoa = toAoa(rows, columns);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    new Blob([wbout], { type: 'application/octet-stream' }),
    filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  );
}
