// Single distribution person, open-route optimizer (orienteering problem).
//
// OR-Tools has no clean Node binding, so we use a strong heuristic that suits
// this exact problem: one vehicle, start fixed at location 0, open route (no
// return), a single stop time per location, and a hard time budget (the shift).
//
//   1. Greedy cheapest-insertion: repeatedly insert the unvisited location that
//      adds the least driving while staying within the budget -> maximizes the
//      number of locations covered.
//   2. 2-opt + Or-opt local search: reorder the chosen stops to cut total
//      driving (location 0 stays first).
//   3. Re-insert: freed-up time may now fit more stops. Repeat until stable.
//
// Returns { route: number[] (location indices, starting with 0), dropped: number[] }.

const EPS = 1e-6;

export function totalDrive(route, M) {
  let d = 0;
  for (let k = 0; k + 1 < route.length; k++) d += M[route[k]][route[k + 1]];
  return d;
}

export function totalTime(route, M, service) {
  let s = 0;
  for (const i of route) s += service[i];
  return s + totalDrive(route, M);
}

function greedyInsert(route, visited, M, service, budget) {
  let curTime = totalTime(route, M, service);
  for (;;) {
    let best = null; // { u, pos, deltaDrive, deltaTime }
    for (let u = 0; u < M.length; u++) {
      if (visited[u]) continue;
      for (let pos = 1; pos <= route.length; pos++) {
        const prev = route[pos - 1];
        let deltaDrive;
        if (pos === route.length) {
          deltaDrive = M[prev][u]; // append to an open route
        } else {
          const next = route[pos];
          deltaDrive = M[prev][u] + M[u][next] - M[prev][next];
        }
        const deltaTime = deltaDrive + service[u];
        if (curTime + deltaTime <= budget + EPS) {
          if (!best || deltaDrive < best.deltaDrive - EPS) {
            best = { u, pos, deltaDrive, deltaTime };
          }
        }
      }
    }
    if (!best) break;
    route.splice(best.pos, 0, best.u);
    visited[best.u] = true;
    curTime += best.deltaTime;
  }
  return curTime;
}

function twoOpt(route, M) {
  // Open-path 2-opt; keep route[0] fixed. Returns true if improved.
  let improved = false;
  let go = true;
  while (go) {
    go = false;
    for (let i = 1; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const a = route[i - 1];
        const b = route[i];
        const c = route[j];
        const dNext = j + 1 < route.length ? route[j + 1] : -1;
        const before = M[a][b] + (dNext >= 0 ? M[c][dNext] : 0);
        const after = M[a][c] + (dNext >= 0 ? M[b][dNext] : 0);
        if (after < before - EPS) {
          let lo = i, hi = j;
          while (lo < hi) {
            const t = route[lo];
            route[lo] = route[hi];
            route[hi] = t;
            lo++;
            hi--;
          }
          improved = true;
          go = true;
        }
      }
    }
  }
  return improved;
}

function orOpt(route, M) {
  // Move segments of length 1..3 to a better position. Keep route[0] fixed.
  let improved = false;
  let go = true;
  while (go) {
    go = false;
    for (let segLen = 1; segLen <= 3; segLen++) {
      for (let i = 1; i + segLen <= route.length; i++) {
        const seg = route.slice(i, i + segLen);
        const rest = route.slice(0, i).concat(route.slice(i + segLen));
        const baseDrive = totalDrive(route, M);
        let bestPos = -1;
        let bestDrive = baseDrive;
        for (let pos = 1; pos <= rest.length; pos++) {
          const cand = rest.slice(0, pos).concat(seg, rest.slice(pos));
          const d = totalDrive(cand, M);
          if (d < bestDrive - EPS) {
            bestDrive = d;
            bestPos = pos;
          }
        }
        if (bestPos >= 0) {
          route.length = 0;
          route.push(...rest.slice(0, bestPos), ...seg, ...rest.slice(bestPos));
          improved = true;
          go = true;
        }
      }
    }
  }
  return improved;
}

/**
 * @param {number[][]} M  travel matrix (seconds), M[0] = location 0 (start anchor)
 * @param {number[]} service  seconds per location
 * @param {number} shiftSeconds  available time budget
 * @returns {{route:number[], dropped:number[]}}
 */
export function solveRoute(M, service, shiftSeconds) {
  const m = M.length;
  const route = [0];
  const visited = new Array(m).fill(false);
  visited[0] = true;

  greedyInsert(route, visited, M, service, shiftSeconds);
  for (let iter = 0; iter < 20; iter++) {
    const a = twoOpt(route, M);
    const b = orOpt(route, M);
    const before = route.length;
    greedyInsert(route, visited, M, service, shiftSeconds);
    const grew = route.length !== before;
    if (!a && !b && !grew) break;
  }

  const dropped = [];
  for (let i = 0; i < m; i++) if (!visited[i]) dropped.push(i);
  return { route, dropped };
}
