// Minimal, dependency-free CSV parser/stringifier (RFC-4180-ish).
// Handles quoted fields, embedded commas/quotes/newlines.

export function parseCSV(text) {
  const rows = [];
  let field = "";
  let record = [];
  let i = 0;
  let inQuotes = false;
  const n = text.length;
  // strip a UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    rows.push(record);
    record = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      pushField();
      i += 1;
    } else if (c === "\r") {
      i += 1; // handled by following \n (or treat as line end)
      if (text[i] !== "\n") {
        pushField();
        pushRecord();
      }
    } else if (c === "\n") {
      pushField();
      pushRecord();
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  // flush trailing field/record (if file doesn't end in newline)
  if (field.length > 0 || record.length > 0) {
    pushField();
    pushRecord();
  }

  if (rows.length === 0) return { columns: [], records: [] };
  const columns = rows[0];
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0] === "") continue; // skip blank lines
    const obj = {};
    for (let c = 0; c < columns.length; c++) {
      obj[columns[c]] = row[c] !== undefined ? row[c] : "";
    }
    records.push(obj);
  }
  return { columns, records };
}

function escapeField(v) {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function stringifyCSV(records, columns) {
  if (!columns) {
    columns = records.length ? Object.keys(records[0]) : [];
  }
  const lines = [columns.map(escapeField).join(",")];
  for (const rec of records) {
    lines.push(columns.map((c) => escapeField(rec[c])).join(","));
  }
  return lines.join("\n") + "\n";
}
