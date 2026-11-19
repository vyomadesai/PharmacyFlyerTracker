#!/usr/bin/env node
// Distribution campaign route optimizer (single distribution person), Node.js.
//
// Given a list of doctors (CSV with street addresses) and how many hours one
// person is available, builds the optimized, ordered location-to-location route
// to drive within that window. The route starts at the first doctor in the list
// and is open-ended. Locations that don't fit are left for the next campaign.
//
// Example:
//   node optimize_routes.js --input St.PetersburgArea_DoctorList.csv --hours 8 --pit-stop 15

import fs from "node:fs";
import path from "node:path";
import { parseCSV, stringifyCSV } from "./src/csv.js";
import { buildQuery, geocodeAddresses } from "./src/geocoding.js";
import { buildTravelMatrix } from "./src/travel.js";
import { solveRoute, totalDrive } from "./src/optimizer.js";
import { buildMapHTML } from "./src/mapHtml.js";

const MPH_TO_KMH = 1.60934;

function parseArgs(argv) {
  const defaults = {
    input: "St.PetersburgArea_DoctorList.csv",
    ids: null,
    "pit-stop": 15,
    hours: 8,
    travel: "osrm",
    "avg-speed": 30,
    detour: 1.3,
    "osrm-url": "https://router.project-osrm.org",
    "start-time": "09:00",
    outdir: "routes_output",
    "active-only": false,
  };
  const numeric = new Set(["pit-stop", "hours", "avg-speed", "detour"]);
  const args = { ...defaults };
  for (let i = 2; i < argv.length; i++) {
    let key = argv[i];
    if (!key.startsWith("--")) continue;
    key = key.slice(2);
    if (key === "active-only") {
      args[key] = true;
      continue;
    }
    const val = argv[++i];
    args[key] = numeric.has(key) ? parseFloat(val) : val;
  }
  return args;
}

function loadDoctors(args) {
  const text = fs.readFileSync(args.input, "utf8");
  const { columns, records } = parseCSV(text);
  let rows = records;
  if (args["active-only"] && columns.includes("IsActive")) {
    rows = rows.filter((r) => (r.IsActive || "").trim().toUpperCase() !== "N");
  }
  if (args.ids) {
    const ids = new Set(
      fs.readFileSync(args.ids, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    );
    rows = rows.filter((r) => ids.has(r.ID));
  }
  return { columns, rows };
}

async function buildLocations(rows) {
  const queries = rows.map((r) =>
    buildQuery(r.AddressStreet, r.AddressCity, r.AddressState, r.AddressZip)
  );
  const coordsByQ = await geocodeAddresses(queries);

  const locCoords = [];
  const locDoctorRows = [];
  const keyToIdx = new Map();
  const ungeocoded = [];

  rows.forEach((row, i) => {
    const c = coordsByQ.get(queries[i]);
    if (!c) {
      ungeocoded.push(row);
      return;
    }
    const key = `${c[0].toFixed(4)},${c[1].toFixed(4)}`; // ~11 m: merge same-building variants
    if (!keyToIdx.has(key)) {
      keyToIdx.set(key, locCoords.length);
      locCoords.push([c[0], c[1]]);
      locDoctorRows.push([]);
    }
    locDoctorRows[keyToIdx.get(key)].push(i);
  });

  return { locCoords, locDoctorRows, ungeocoded };
}

const pad2 = (n) => String(n).padStart(2, "0");
function clock(startMin, sec) {
  const total = startMin + Math.round(sec / 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function gmapsUrl(coords) {
  if (!coords.length) return "";
  const base = "https://www.google.com/maps/dir/?api=1";
  const origin = `&origin=${coords[0][0]},${coords[0][1]}`;
  const dest = `&destination=${coords[coords.length - 1][0]},${coords[coords.length - 1][1]}`;
  let way = "";
  if (coords.length > 2) {
    way = "&waypoints=" + coords.slice(1, -1).map(([la, lo]) => `${la},${lo}`).join("|");
  }
  return base + origin + dest + way;
}

function main() {
  const args = parseArgs(process.argv);

  const { columns, rows } = loadDoctors(args);
  console.log(`[load] ${rows.length} doctors from ${args.input}`);

  return buildLocations(rows).then(async ({ locCoords, locDoctorRows, ungeocoded }) => {
    console.log(
      `[locations] ${locCoords.length} unique routable locations ` +
        `(${ungeocoded.length} doctors could not be geocoded)`
    );
    if (locCoords.length < 2) {
      console.error("Need at least 2 routable locations to plan a route.");
      process.exit(1);
    }

    const { matrix: M, engine } = await buildTravelMatrix(locCoords, {
      engine: args.travel,
      avgSpeedKmh: args["avg-speed"] * MPH_TO_KMH,
      detourFactor: args.detour,
      osrmUrl: args["osrm-url"],
    });
    console.log(`[travel] ${M.length}x${M.length} matrix via ${engine}`);

    const stopSec = Math.round(args["pit-stop"] * 60);
    const service = locCoords.map(() => stopSec);
    const budget = Math.round(args.hours * 3600);

    const { route, dropped } = solveRoute(M, service, budget);

    writeOutputs(args, columns, rows, locCoords, locDoctorRows, route, dropped, ungeocoded, engine, M, service, budget);
  });
}

function writeOutputs(args, columns, rows, locCoords, locDoctorRows, route, dropped, ungeocoded, engine, M, service, budget) {
  fs.mkdirSync(args.outdir, { recursive: true });
  const [sh, sm] = args["start-time"].split(":").map(Number);
  const startMin = sh * 60 + sm;
  const origCols = columns.filter((c) => !c.startsWith("__"));

  // Build per-stop rows with timing.
  const stopRows = [];
  const routeCoords = [];
  const routedRecords = []; // { stopOrder, rowIdx }
  let departPrev = 0;
  let driveSum = 0;
  let serviceSum = 0;
  route.forEach((locIdx, k) => {
    const docRows = locDoctorRows[locIdx].map((ri) => rows[ri]);
    const [la, lo] = locCoords[locIdx];
    routeCoords.push([la, lo]);
    const drive = k === 0 ? 0 : M[route[k - 1]][locIdx];
    const arrive = k === 0 ? 0 : departPrev + drive;
    const svc = service[locIdx];
    const depart = arrive + svc;
    departPrev = depart;
    driveSum += drive;
    serviceSum += svc;
    locDoctorRows[locIdx].forEach((ri) => routedRecords.push({ stopOrder: k + 1, rowIdx: ri }));
    const names = docRows
      .map((d) => `${d.Doctor_FirstName} ${d.Doctor_LastName}`.trim())
      .join("; ");
    const phones = [...new Set(docRows.map((d) => d.Phone1).filter(Boolean))].sort().join("; ");
    stopRows.push({
      stop_order: k + 1,
      arrive: clock(startMin, arrive),
      depart: clock(startMin, depart),
      drive_min_from_prev: Math.round((drive / 60) * 10) / 10,
      service_min: Math.round((svc / 60) * 10) / 10,
      address: docRows[0].AddressStreet,
      city: docRows[0].AddressCity,
      zip: docRows[0].AddressZip,
      num_doctors: docRows.length,
      doctor_ids: docRows.map((d) => d.ID).join("; "),
      doctor_names: names,
      phones,
      lat: la,
      lon: lo,
    });
  });

  const routeFields = [
    "stop_order", "arrive", "depart", "drive_min_from_prev", "service_min",
    "address", "city", "zip", "num_doctors", "doctor_ids", "doctor_names",
    "phones", "lat", "lon",
  ];
  fs.writeFileSync(path.join(args.outdir, "route.csv"), stringifyCSV(stopRows, routeFields));

  const gmaps = gmapsUrl(routeCoords);
  const title = `Distribution route - ${stopRows.length} stops, ${args.hours}h, ${args["pit-stop"]} min/stop`;
  fs.writeFileSync(path.join(args.outdir, "route_map.html"), buildMapHTML(stopRows, title, gmaps));

  // routing_list.csv: campaign doctors in visit order, original columns + stop_order
  const routedRows = routedRecords.map((r) => ({ stop_order: r.stopOrder, ...rows[r.rowIdx] }));
  fs.writeFileSync(
    path.join(args.outdir, "routing_list.csv"),
    stringifyCSV(routedRows, ["stop_order", ...origCols])
  );

  // remaining_doctors.csv: reduced master list (input minus routed)
  const routedIdx = new Set(routedRecords.map((r) => r.rowIdx));
  const remaining = rows.filter((_, i) => !routedIdx.has(i));
  fs.writeFileSync(path.join(args.outdir, "remaining_doctors.csv"), stringifyCSV(remaining, origCols));

  // uncovered.csv
  const dropRows = [];
  for (const li of dropped) {
    for (const ri of locDoctorRows[li]) {
      const d = rows[ri];
      dropRows.push({
        reason: "not_enough_capacity", ID: d.ID,
        name: `${d.Doctor_FirstName} ${d.Doctor_LastName}`.trim(),
        address: d.AddressStreet, zip: d.AddressZip,
      });
    }
  }
  for (const d of ungeocoded) {
    dropRows.push({
      reason: "could_not_geocode", ID: d.ID,
      name: `${d.Doctor_FirstName} ${d.Doctor_LastName}`.trim(),
      address: d.AddressStreet, zip: d.AddressZip,
    });
  }
  fs.writeFileSync(
    path.join(args.outdir, "uncovered.csv"),
    stringifyCSV(dropRows, ["reason", "ID", "name", "address", "zip"])
  );

  // summary.csv
  const totalSec = driveSum + serviceSum;
  const summary = [{
    person: 1,
    shift_hours: Math.round((budget / 3600) * 100) / 100,
    locations: stopRows.length,
    doctors: routedRecords.length,
    drive_min: Math.round((driveSum / 60) * 10) / 10,
    service_min: Math.round((serviceSum / 60) * 10) / 10,
    total_min: Math.round((totalSec / 60) * 10) / 10,
    utilization_pct: budget ? Math.round((1000 * totalSec) / budget) / 10 : 0,
    gmaps_url: gmaps,
  }];
  fs.writeFileSync(
    path.join(args.outdir, "summary.csv"),
    stringifyCSV(summary, Object.keys(summary[0]))
  );

  // console report
  const s = summary[0];
  console.log("\n==================== ROUTE SUMMARY ====================");
  console.log(
    `person 1 | shift ${s.shift_hours}h | locations ${s.locations} | doctors ${s.doctors} | ` +
      `drive ${s.drive_min} min | service ${s.service_min} min | total ${s.total_min} min | ` +
      `util ${s.utilization_pct}%`
  );
  console.log(`\nWithin ${args.hours}h: visit ${s.locations} locations (${s.doctors} doctors).`);
  console.log(
    `Reduced master list: ${rows.length} doctors in -> ${remaining.length} doctors remaining ` +
      `(${routedRecords.length} routed this campaign).`
  );
  if (gmaps) console.log(`\nGoogle Maps route: ${gmaps}`);
  console.log(`\nOutputs written to: ${path.resolve(args.outdir)}/`);
  console.log("  - routing_list.csv       (this campaign's doctors, in visit order)");
  console.log("  - remaining_doctors.csv  (reduced master list -> use as next --input)");
  console.log("  - route_map.html         (interactive map of the route)");
  console.log("  - route.csv              (the ordered stop list, one row per location)");
  console.log("  - summary.csv            (totals + Google Maps directions URL)");
  console.log("  - uncovered.csv          (doctors not routed: didn't fit / PO BOX)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
