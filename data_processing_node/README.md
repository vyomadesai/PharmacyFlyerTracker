# Distribution Campaign Route Optimizer — Node.js

A **zero-dependency Node.js** port of the Python route optimizer. Same inputs,
same outputs, same behavior — built to drop into a Node/JavaScript frontend or
backend.

Given a list of doctors (CSV with street addresses) and how many hours one
distribution person is available, it produces the optimized, ordered
location-to-location route to drive within that window. Whatever doesn't fit is
left for the next campaign.

---

## 1. Requirements

- **Node.js >= 18** (uses the built-in global `fetch`; no `npm install` needed).
- That's it — there are **no third-party dependencies**.

Check your version:

```bash
node --version
```

---

## 2. Run it

```bash
node optimize_routes.js --input St.PetersburgArea_DoctorList.csv --hours 8 --pit-stop 10 --outdir VyomaNode
```

- `--hours 8` — how long the distribution person is available (use `--hours 4`, etc).
- `--pit-stop 10` — minutes spent at each location (e.g. 10–15).
- `--outdir VyomaNode` — folder to write the results into (defaults to `routes_output`).

> Node must be on your PATH. If `node` isn't found, install it (e.g. `brew install node`)
> or, if you installed it into a conda env, run `conda activate <env>` first.

### Plan the next campaign from the reduced list

```bash
node optimize_routes.js --input routes_output/remaining_doctors.csv --hours 8 --pit-stop 15
```

Or keep the master and subset by IDs: `--ids ids.txt` (one doctor ID per line).

---

## 3. All parameters

| Flag | Default | Meaning |
|------|---------|---------|
| `--input` | `St.PetersburgArea_DoctorList.csv` | CSV of doctors to plan over |
| `--ids` | — | File of doctor IDs (one per line) to subset `--input` |
| `--pit-stop` | `15` | Minutes spent at each location |
| `--hours` | `8` | Hours the distribution person is available |
| `--travel` | `osrm` | `osrm` (real roads) or `offline` (estimate) |
| `--avg-speed` | `30` | Offline mode average speed (mph) |
| `--detour` | `1.3` | Offline mode detour factor |
| `--osrm-url` | public server | OSRM base URL (point at your own server if you have one) |
| `--start-time` | `09:00` | Clock start time for arrival/departure display |
| `--outdir` | `routes_output` | Where to write results |
| `--active-only` | off | Exclude rows with `IsActive == 'N'` |

---

## 4. Outputs (in `routes_output/`)

Same as the Python version:

- **`routing_list.csv`** — this campaign's doctors, in visit order (original columns + `stop_order`).
- **`remaining_doctors.csv`** — the reduced master list (input minus routed doctors); feed back as the next `--input`.
- **`route_map.html`** — interactive Leaflet map of the route (numbered stops, popups, Google Maps link).
- **`route.csv`** — ordered stop list, one row per location, with arrival/departure times.
- **`summary.csv`** — totals + Google Maps directions URL.
- **`uncovered.csv`** — doctors not routed (didn't fit, or PO BOX / un-geocodable).

---

## 5. How it works (and the one difference from Python)

1. **Geocoding** — addresses → GPS via OpenStreetMap/Nominatim, normalized (suite
   numbers stripped, `NO`/`SO`/`AV` expanded, etc.) with a ZIP-centroid fallback.
   Cached in `cache/geocode_cache.json` — **the exact same file format as the
   Python version**, so the two share the cache and neither re-geocodes.
2. **Driving times** — real road durations from the public **OSRM** server (tiled
   to respect its 100-coordinate limit), with an offline estimate fallback. Cached
   as JSON in `cache/`.
3. **Optimization** — the Python version uses Google OR-Tools, which has no clean
   Node binding. This port reimplements the **single-vehicle open-route
   optimization** as a heuristic tuned for exactly this problem:
   - greedy cheapest-insertion to **maximize locations covered** within the time budget,
   - **2-opt + Or-opt** local search to cut total driving,
   - re-insertion until stable.

   Results are equivalent in practice for the single-person case (the binding
   constraint is usually the stop time, not the routing).

---

## 6. Embedding in your frontend

Everything is ES modules with no side effects on import, so you can call the
pieces directly instead of shelling out to the CLI:

```js
import { geocodeAddresses, buildQuery } from "./src/geocoding.js";
import { buildTravelMatrix } from "./src/travel.js";
import { solveRoute } from "./src/optimizer.js";

const coords = [[27.77, -82.65], [27.78, -82.64], /* ... */];   // location 0 = start anchor
const { matrix } = await buildTravelMatrix(coords, { engine: "osrm" });
const service = coords.map(() => 15 * 60);                       // 15 min per stop, seconds
const { route, dropped } = solveRoute(matrix, service, 8 * 3600); // 8h budget
// route = ordered location indices starting at 0; dropped = left for next campaign
```

The optimizer (`src/optimizer.js`) is pure CPU and needs no network — only
geocoding and OSRM use `fetch`.

---

## 7. Notes

- `routes_output/` is overwritten each run. Copy `remaining_doctors.csv` out (or
  use a different `--outdir`) between campaigns to keep a history.
- The geocode cache here was copied from the Python project, so the first run
  already had all addresses resolved. New/changed addresses are looked up and
  cached automatically (rate-limited to ~1/sec per Nominatim policy).
