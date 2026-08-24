/* eslint-env node */

/**
 * Shrinking a path without changing what it draws.
 *
 * There is a standard tool for this — SVGO, whose `convertPathData` does the
 * same job and more. It is not a dependency here because this is the only thing
 * in the repository that would want it, it runs at build time on fourteen
 * files, and the part that actually matters is fifty lines. If the artwork ever
 * grows past what this handles, reach for SVGO rather than growing this.
 *
 * The problem it solves: a traced bitmap arrives with far more precision and far
 * more points than a 1024-unit box can show. The winter jacket is the extreme
 * case at 3850 numbers, most of them to three decimals — at the size an avatar
 * renders that is a ten thousandth of a pixel, and every one of those digits is
 * shipped to every client that sees somebody wearing it.
 *
 * This is the closest thing here to merging vertices by distance: rounding pulls
 * near-coincident points onto each other, and the passes after it delete what
 * that leaves behind.
 */

/**
 * A path as a list of absolute segments, commands kept.
 *
 * Deliberately narrow. It handles what a drawing tool emits for this artwork and
 * refuses everything else, rather than silently mangling a construct it does not
 * understand.
 */
export function parsePath(d) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
  const out = [];
  let i = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let command = "";
  const num = () => Number(tokens[i++]);

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) command = tokens[i++];
    const rel = command === command.toLowerCase();
    const c = command.toUpperCase();
    if (c === "A") throw new Error("arc commands are not supported");

    if (c === "Z") {
      out.push({ type: "Z", pts: [] });
      x = sx;
      y = sy;
      continue;
    }
    if (c === "M") {
      x = rel ? x + num() : num();
      y = rel ? y + num() : num();
      sx = x;
      sy = y;
      out.push({ type: "M", pts: [x, y] });
      // A second coordinate pair after M is a lineto, per the spec.
      command = rel ? "l" : "L";
      continue;
    }
    if (c === "L" || c === "H" || c === "V") {
      if (c === "H") x = rel ? x + num() : num();
      else if (c === "V") y = rel ? y + num() : num();
      else {
        x = rel ? x + num() : num();
        y = rel ? y + num() : num();
      }
      out.push({ type: "L", pts: [x, y] });
      continue;
    }
    if (c === "C") {
      const x1 = rel ? x + num() : num();
      const y1 = rel ? y + num() : num();
      const x2 = rel ? x + num() : num();
      const y2 = rel ? y + num() : num();
      x = rel ? x + num() : num();
      y = rel ? y + num() : num();
      out.push({ type: "C", pts: [x1, y1, x2, y2, x, y] });
      continue;
    }
    if (c === "Q") {
      const qx = rel ? x + num() : num();
      const qy = rel ? y + num() : num();
      const ex = rel ? x + num() : num();
      const ey = rel ? y + num() : num();
      out.push({
        type: "C",
        pts: [
          x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
          ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey),
          ex, ey,
        ],
      });
      x = ex;
      y = ey;
      continue;
    }
    throw new Error(`unsupported path command "${command}"`);
  }
  return out;
}

/** How far a point sits off the line through a and b. */
function offLine(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * (px - ax) - dx * (py - ay)) / len;
}

/** As short as a number can be written and still parse the same. */
function short(n) {
  const s = String(n);
  if (s.startsWith("0.")) return s.slice(1);
  if (s.startsWith("-0.")) return "-" + s.slice(2);
  return s;
}

/**
 * Four passes, in order:
 *
 *   - round every coordinate to `places`,
 *   - drop segments that go nowhere, which is what rounding leaves behind and
 *     what a vectoriser emits anyway,
 *   - turn a curve whose control points sit on its own chord into the line it
 *     already was,
 *   - merge runs of collinear lines into one.
 *
 * `tolerance` is in artwork units, so 0.4 means "a curve that never leaves four
 * tenths of a unit of its chord is a straight line". On a 1024 box drawn at 32
 * pixels that is a hundredth of a pixel; at 512 it is still under a fifth.
 */
/** A coarse outline of a path: enough to tell whether two of them agree. */
function outline(segments) {
  const points = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  for (const seg of segments) {
    if (seg.type === "Z") {
      points.push([sx, sy]);
      x = sx;
      y = sy;
      continue;
    }
    if (seg.type === "M") {
      [x, y] = seg.pts;
      sx = x;
      sy = y;
      points.push([x, y]);
      continue;
    }
    if (seg.type === "L") {
      [x, y] = seg.pts;
      points.push([x, y]);
      continue;
    }
    const [x1, y1, x2, y2, ex, ey] = seg.pts;
    for (let k = 1; k <= 6; k += 1) {
      const t = k / 6;
      const u = 1 - t;
      points.push([
        u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
        u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey,
      ]);
    }
    x = ex;
    y = ey;
  }
  let area = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < points.length; k += 1) {
    const [px, py] = points[k];
    const [qx, qy] = points[(k + 1) % points.length];
    area += px * qy - qx * py;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  return { area: Math.abs(area) / 2, minX, minY, maxX, maxY };
}

export function simplifyPath(d, places = 1, tolerance = 0.4) {
  const round = (n) => Number(n.toFixed(places));
  const segments = parsePath(d).map((s) => ({ type: s.type, pts: s.pts.map(round) }));

  const out = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;

  for (const seg of segments) {
    if (seg.type === "M") {
      [x, y] = seg.pts;
      sx = x;
      sy = y;
      out.push(seg);
      continue;
    }
    if (seg.type === "Z") {
      // A line back to where the subpath started, followed by Z, is one thing
      // said twice: Z draws that line itself.
      const last = out[out.length - 1];
      if (last && last.type === "L" && last.pts[0] === sx && last.pts[1] === sy) out.pop();
      out.push(seg);
      x = sx;
      y = sy;
      continue;
    }

    if (seg.type === "C") {
      const [x1, y1, x2, y2, ex, ey] = seg.pts;
      if (ex === x && ey === y && x1 === x && y1 === y && x2 === x && y2 === y) continue;
      if (
        offLine(x1, y1, x, y, ex, ey) <= tolerance &&
        offLine(x2, y2, x, y, ex, ey) <= tolerance
      ) {
        seg.type = "L";
        seg.pts = [ex, ey];
      }
    }

    if (seg.type === "L") {
      const [ex, ey] = seg.pts;
      if (ex === x && ey === y) continue;
      // Straight on from the previous line: extend that one instead of adding.
      const last = out[out.length - 1];
      if (last && last.type === "L" && out.length >= 2) {
        const prev = out[out.length - 2];
        const [px, py] = prev.type === "Z" ? [sx, sy] : prev.pts.slice(-2);
        if (offLine(last.pts[0], last.pts[1], px, py, ex, ey) <= tolerance) {
          last.pts = [ex, ey];
          x = ex;
          y = ey;
          continue;
        }
      }
    }

    out.push(seg);
    [x, y] = seg.pts.slice(-2);
  }

  let text = "";
  let previous = "";
  for (const seg of out) {
    if (seg.type === "Z") {
      text += "Z";
      previous = "";
      continue;
    }
    // A repeated command letter is implied and can be left out — except after
    // M, where an implied repeat means L, not another M. Leaving it out there
    // welds every subpath of a path into one, which is invisible in the numbers
    // and unmistakable on screen.
    const letter = seg.type !== "M" && seg.type === previous ? "" : seg.type;
    previous = seg.type;
    let body = "";
    for (const n of seg.pts) {
      const t = short(n);
      body += body === "" || t.startsWith("-") || t.startsWith(".") ? t : " " + t;
    }
    // Without a letter to separate them, the first number of this segment runs
    // into the last number of the one before it. A leading minus or point is
    // its own separator; anything else needs a space.
    const glue = letter === "" && !/^[-.]/.test(body) ? " " : "";
    text += letter + glue + body;
  }

  /*
   * Check the result draws the same shape, and give up on this path if it does
   * not. Two bugs got through here before this existed — a dropped M that welded
   * every subpath into one, and numbers running together where a command letter
   * had been left out — and neither was visible in the output, only on screen.
   * Every path that survives this is one that has been compared against itself.
   */
  const was = outline(segments);
  const now = outline(parsePath(text));
  const span = Math.max(was.maxX - was.minX, was.maxY - was.minY, 1);
  const slipped =
    Math.abs(now.area - was.area) > Math.max(was.area * 0.02, span * tolerance) ||
    Math.abs(now.minX - was.minX) > span * 0.01 ||
    Math.abs(now.minY - was.minY) > span * 0.01 ||
    Math.abs(now.maxX - was.maxX) > span * 0.01 ||
    Math.abs(now.maxY - was.maxY) > span * 0.01;
  return slipped ? d : text;
}
