// Isometric element icons, generated as inline SVG (no image assets). Every element is a small illustrated
// object built from one kit of rounded isometric parts (boxes, cylinders, spheres) in three tones (lit top,
// mid left face, dark right face) with light-blue accents, like a set of server-room illustrations.
// Grid coordinates: x runs right-down, y runs left-down, z is up. UI only.
window.SIM = window.SIM || {};

(function () {
  // ---------- colour ----------
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  function shade(hex, amt) { // mix toward white (amt > 0) or black (amt < 0)
    const t = amt < 0 ? 0 : 255, a = Math.abs(amt);
    return '#' + rgb(hex).map((c) => clamp(c + (t - c) * a).toString(16).padStart(2, '0')).join('');
  }
  const tones = (hex) => ({ top: shade(hex, 0.3), left: shade(hex, -0.02), right: shade(hex, -0.32), ink: shade(hex, -0.62), hi: shade(hex, 0.6), base: hex });
  const ACC = '#7cc4ff', WARM = '#fde047', OK = '#4ade80', PINK = '#f9a8d4', SKIN = '#f6c8a0', WHITE = '#f1f5f9', DARK = '#0f172a';
  const GOLD = tones('#f59e0b'), CARD = tones('#c08457'), RED = tones('#ef4444'), SILVER = tones('#94a3b8');

  // ---------- isometric kit ----------
  const U = 9, OX = 48, OY = 36; // scale and screen origin
  const P = (x, y, z) => [OX + (x - y) * 0.866 * U, OY + (x + y) * 0.5 * U - z * U];
  const f = (n) => Math.round(n * 10) / 10;
  const pts = (a) => a.map((p) => f(p[0]) + ',' + f(p[1])).join(' ');
  const poly = (a, fill, extra) => `<polygon points="${pts(a)}" fill="${fill}" ${extra || ''}/>`;
  const edge = (fill) => `stroke="${fill}" stroke-width="1.3" stroke-linejoin="round"`; // rounds the corners
  const shape = (map, a, fill, extra) => poly(a.map(([u, v]) => map(u, v)), fill, extra);
  const ring = (cu, cv, r, n) => Array.from({ length: n || 10 }, (_, i) => { const t = (2 * Math.PI * i) / (n || 10); return [cu + r * Math.cos(t), cv + r * Math.sin(t)]; });
  const dot = (map, u, v, r, fill) => shape(map, ring(u, v, r, 8), fill);
  const line = (a, stroke, w, extra) => `<polyline points="${pts(a)}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}/>`;
  let uid = 0;
  const gid = () => 'ic' + (++uid);

  // A rounded isometric box. Returns its markup plus mappers onto its faces for drawing details.
  function box(x0, y0, z0, dx, dy, dz, c, noInset) {
    const x1 = x0 + dx, y1 = y0 + dy, z1 = z0 + dz;
    const top = [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)];
    const left = [P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)];
    const right = [P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), P(x1, y0, z0)];
    let s = poly(left, c.left, edge(c.left)) + poly(right, c.right, edge(c.right)) + poly(top, c.top, edge(c.top));
    if (!noInset && dx > 1.2 && dy > 1.2) { // the recessed top plate
      const m = 0.35;
      s += poly([P(x0 + m, y0 + m, z1), P(x1 - m, y0 + m, z1), P(x1 - m, y1 - m, z1), P(x0 + m, y1 - m, z1)], shade(c.top, -0.1));
    }
    s += line([P(x0, y1, z1), P(x1, y1, z1), P(x1, y0, z1)], '#fff', 0.8, 'stroke-opacity=".35"');
    return { s, x0, y0, z0, x1, y1, z1, LF: (x, z) => P(x, y1, z), RF: (y, z) => P(x1, y, z), T: (x, y) => P(x, y, z1) };
  }
  // A thin standing plate on the plane y = const (looks like the left face), for shields, flags, charts.
  const plateMap = (y) => (x, z) => P(x, y, z);

  function cyl(cx, cy, z0, r, h, c) {
    const [px, py] = P(cx, cy, z0 + h), by = P(cx, cy, z0)[1];
    const rx = r * U * 1.2247, ry = r * U * 0.7071, id = gid();
    return `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${c.left}"/><stop offset=".45" stop-color="${c.top}"/><stop offset="1" stop-color="${c.right}"/></linearGradient></defs>`
      + `<path d="M${f(px - rx)} ${f(py)} V${f(by)} A${f(rx)} ${f(ry)} 0 0 0 ${f(px + rx)} ${f(by)} V${f(py)} Z" fill="url(#${id})"/>`
      + `<ellipse cx="${f(px)}" cy="${f(py)}" rx="${f(rx)}" ry="${f(ry)}" fill="${c.top}"/>`
      + `<ellipse cx="${f(px)}" cy="${f(py)}" rx="${f(rx * 0.72)}" ry="${f(ry * 0.72)}" fill="${shade(c.top, -0.1)}"/>`;
  }
  function sphere(x, y, z, r, hex) {
    const [cx, cy] = P(x, y, z), id = gid();
    return `<defs><radialGradient id="${id}" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="${shade(hex, 0.7)}"/><stop offset=".5" stop-color="${hex}"/><stop offset="1" stop-color="${shade(hex, -0.55)}"/></radialGradient></defs>`
      + `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * U)}" fill="url(#${id})"/>`;
  }
  // Server-unit front: a recessed panel, three lights, a screen, and vent slits on the right face.
  function front(b, c) {
    const w = b.x1 - b.x0, h = b.z1 - b.z0;
    let s = shape(b.LF, [[b.x0 + 0.25, b.z0 + 0.18], [b.x1 - 0.25, b.z0 + 0.18], [b.x1 - 0.25, b.z1 - 0.18], [b.x0 + 0.25, b.z1 - 0.18]], shade(c.left, -0.22));
    for (let i = 0; i < 3; i++) s += dot(b.LF, b.x0 + 0.55 + i * 0.32, b.z0 + h * 0.55, 0.09, ACC);
    s += shape(b.LF, [[b.x0 + w * 0.5, b.z0 + h * 0.32], [b.x1 - 0.45, b.z0 + h * 0.32], [b.x1 - 0.45, b.z0 + h * 0.62], [b.x0 + w * 0.5, b.z0 + h * 0.62]], ACC);
    for (let i = 0; i < 6; i++) {
      const y = b.y0 + 0.35 + i * ((b.y1 - b.y0 - 0.7) / 5.4);
      s += shape(b.RF, [[y, b.z0 + 0.22], [y + 0.1, b.z0 + 0.22], [y + 0.1, b.z1 - 0.22], [y, b.z1 - 0.22]], ACC, 'opacity=".9"');
    }
    return s;
  }
  const arrow = (map, a, b, fill) => { // an arrow lying on a plane (map takes (u, v))
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, px = -uy, py = ux;
    const base = [b[0] - ux * 0.5, b[1] - uy * 0.5];
    return line([map(...a), map(...base)], fill, 2.2)
      + shape(map, [b, [base[0] + px * 0.32, base[1] + py * 0.32], [base[0] - px * 0.32, base[1] - py * 0.32]], fill);
  };

  // ---------- the 26 icons ----------
  const ICONS = {
    trafficSource(c) { // a transmitter: server unit, mast and signal arcs
      const slab = box(0.2, 0.2, 0, 3.6, 3.6, 0.6, c), unit = box(0.9, 1.4, 0.6, 2.2, 1.8, 1.1, c);
      const [mx, my] = P(2, 1.2, 3.7);
      return slab.s + unit.s + front(unit, c) + box(1.9, 1.0, 1.7, 0.22, 0.22, 1.6, SILVER, true).s + sphere(2, 1.1, 3.5, 0.3, ACC)
        + [9, 15, 21].map((r, i) => `<path d="M${f(mx + r * 0.25)} ${f(my - r)} A${r} ${r} 0 0 1 ${f(mx + r)} ${f(my - r * 0.25)}" fill="none" stroke="${ACC}" stroke-width="1.7" stroke-linecap="round" opacity="${1 - i * 0.22}"/>`).join('');
    },
    loadBalancer(c) { // one hub splitting work between three helpers
      let s = box(0.2, 0.2, 0, 3.6, 3.6, 0.6, c).s;
      s += arrow((x, y) => P(x, y, 0.6), [2, 0.5], [2, 1.6], ACC);
      [0.4, 1.55, 2.7].forEach((x) => { const b = box(x, 1.7, 0.6, 0.95, 1.5, 1.1, c, true); s += b.s + dot(b.LF, x + 0.48, 1.15, 0.14, ACC); });
      return s;
    },
    llmSmall(c) { // one compact server unit with a chip
      const b = box(0.4, 0.4, 0, 3.2, 3.2, 1.5, c), chip = box(1.2, 1.2, 1.5, 1.6, 1.6, 0.22, tones(shade(c.base, 0.35)), true);
      return b.s + front(b, c) + chip.s + poly([P(1.55, 1.55, 1.72), P(2.45, 1.55, 1.72), P(2.45, 2.45, 1.72), P(1.55, 2.45, 1.72)], ACC);
    },
    llmLarge(c) { // a tall stack of server units
      return [0, 1.25, 2.5].map((z) => { const b = box(0.4, 0.4, z, 3.2, 3.2, 1.15, c); return b.s + front(b, c); }).join('');
    },
    guardrail(c) { // a shield standing on a plinth
      const plinth = box(0.3, 0.3, 0, 3.4, 3.4, 0.6, c), m = plateMap(2.2);
      const L = [[0.35, 3.9], [1.9, 4.4], [1.9, 0.85], [0.35, 2.7]], R = [[1.9, 4.4], [3.45, 3.9], [3.45, 2.7], [1.9, 0.85]];
      return plinth.s + shape(m, L, c.top, edge(c.top)) + shape(m, R, c.right, edge(c.right))
        + line([m(0.95, 2.95), m(1.6, 2.2), m(2.85, 3.55)], WHITE, 3);
    },
    semanticCache(c) { // a unit with a lightning bolt: instant answers
      const b = box(0.4, 0.4, 0, 3.2, 3.2, 1.3, c);
      return b.s + shape(b.LF, [[0.65, 0.15], [3.35, 0.15], [3.35, 1.15], [0.65, 1.15]], shade(c.left, -0.5))
        + shape(b.LF, [[2.0, 1.05], [1.3, 0.55], [1.75, 0.55], [1.4, 0.15], [2.3, 0.7], [1.85, 0.7], [2.15, 1.05]], '#fff7c2', edge('#fff7c2'))
        + dot(b.LF, 0.95, 0.65, 0.09, ACC) + dot(b.LF, 3.05, 0.65, 0.09, ACC);
    },
    embeddingModel(c) { // a plate with a few bars: numbers that stand for meaning
      const t = tones(ACC); let s = box(0.4, 0.4, 0, 3.2, 3.2, 0.9, c).s;
      [[0.95, 0.95, 0.9], [2.0, 0.95, 1.6], [0.95, 2.0, 1.2], [2.0, 2.0, 0.7]].forEach(([x, y, h]) => { s += box(x, y, 0.9, 0.8, 0.8, h, t, true).s; });
      return s;
    },
    vectorDb(c) { // the classic database drum stack
      let s = '';
      [0, 1.0, 2.0].forEach((z) => {
        const [px, py] = P(2, 2, z + 0.9), ry = 1.6 * U * 0.7071, my = py + ry + 3.5;
        s += cyl(2, 2, z, 1.6, 0.9, c) + `<circle cx="${f(px - 9)}" cy="${f(my)}" r="1.5" fill="${ACC}"/><circle cx="${f(px - 4)}" cy="${f(my + 1.5)}" r="1.5" fill="${ACC}"/><rect x="${f(px + 3)}" y="${f(my - 0.5)}" width="9" height="2.6" rx="1" fill="${ACC}" opacity=".9"/>`;
      });
      return s;
    },
    reranker(c) { // a unit showing a rising bar chart: best answers on top
      const b = box(0.4, 0.4, 0, 3.2, 3.2, 1.5, c);
      let s = b.s + shape(b.LF, [[0.65, 0.2], [3.35, 0.2], [3.35, 1.3], [0.65, 1.3]], shade(c.left, -0.22));
      [0.35, 0.65, 0.95].forEach((h, i) => { const x = 1.0 + i * 0.8; s += shape(b.LF, [[x, 0.3], [x + 0.5, 0.3], [x + 0.5, 0.3 + h], [x, 0.3 + h]], i === 2 ? OK : ACC); });
      return s;
    },
    rateLimiter(c) { // a boom barrier
      let s = box(0.3, 0.3, 0, 3.4, 3.4, 0.5, c).s + box(0.5, 1.6, 0.5, 0.6, 0.6, 1.8, c, true).s;
      for (let i = 0; i < 5; i++) s += box(1.1 + i * 0.58, 1.65, 2.0, 0.58, 0.5, 0.45, i % 2 ? tones('#f1f5f9') : RED, true).s;
      return s + sphere(0.8, 1.9, 2.55, 0.25, '#ef4444');
    },
    promptRouter(c) { // a hub with arrows pointing three ways
      const b = box(0.4, 0.4, 0, 3.2, 3.2, 1.0, c), T = b.T;
      return b.s + arrow(T, [2, 3.4], [2, 2.05], ACC) + arrow(T, [2, 2], [0.8, 0.8], ACC) + arrow(T, [2, 2], [3.2, 0.8], ACC);
    },
    toolExecutor(c) { // a unit with a gear: it does the work
      const b = box(0.4, 0.4, 0, 3.2, 3.2, 1.5, c), cu = 1.9, cv = 0.78, teeth = [];
      for (let i = 0; i < 16; i++) { const a = (Math.PI * 2 * i) / 16, r = i % 2 ? 0.55 : 0.82; teeth.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]); }
      return b.s + shape(b.LF, teeth, ACC, edge(ACC)) + dot(b.LF, cu, cv, 0.22, c.ink);
    },
    connector(c) { // a plug
      const b = box(0.4, 0.4, 0, 3.2, 3.2, 0.9, c), plug = box(1.0, 1.0, 0.9, 2.0, 2.0, 0.9, tones(shade(c.base, 0.2)));
      return b.s + plug.s + box(1.25, 1.5, 1.8, 0.32, 0.32, 0.8, SILVER, true).s + box(2.45, 1.5, 1.8, 0.32, 0.32, 0.8, SILVER, true).s;
    },
    skill(c) { // a book with page edges and a ribbon
      const b = box(0.3, 0.4, 0, 3.4, 3.2, 1.0, c), pages = shape(b.LF, [[0.55, 0.12], [3.45, 0.12], [3.45, 0.82], [0.55, 0.82]], WHITE);
      return b.s + pages + [0.3, 0.5, 0.7].map((z) => line([b.LF(0.7, z), b.LF(3.3, z)], '#cbd5e1', 0.7)).join('')
        + shape(b.T, [[2.4, 0.5], [2.8, 0.5], [2.8, 2.9], [2.4, 2.9]], RED.top);
    },
    plugin(c) { // a puzzle-piece block with a stud and a notch
      const b = box(0.3, 0.3, 0, 3.4, 3.4, 1.3, c);
      return b.s + shape(b.LF, [[0.7, 0.25], [1.6, 0.25], [1.6, 1.05], [0.7, 1.05]], shade(c.left, -0.3)) + cyl(2.6, 1.4, 1.3, 0.55, 0.55, c);
    },
    observabilityTap(c) { // a monitor with a line chart
      let s = box(1.0, 1.0, 0, 2.0, 2.0, 0.35, c).s + box(1.75, 1.75, 0.35, 0.5, 0.5, 0.9, tones(shade(c.base, -0.2)), true).s;
      const scr = box(0.3, 1.5, 1.25, 3.4, 0.5, 2.3, c, true);
      return s + scr.s + shape(scr.LF, [[0.5, 1.45], [3.5, 1.45], [3.5, 3.35], [0.5, 3.35]], '#0b1220')
        + line([scr.LF(0.75, 1.8), scr.LF(1.35, 2.35), scr.LF(1.9, 1.95), scr.LF(2.5, 2.9), scr.LF(3.2, 2.55)], ACC, 1.6) + dot(scr.LF, 2.5, 2.9, 0.1, WARM);
    },
    memoryStore(c) { // a memory module: chips on a board, gold pins
      const b = box(0.3, 1.2, 0, 3.4, 1.6, 1.8, c);
      let s = b.s;
      [0.65, 1.55, 2.45].forEach((x) => { s += shape(b.LF, [[x, 0.75], [x + 0.8, 0.75], [x + 0.8, 1.5], [x, 1.5]], '#0b1220'); s += dot(b.LF, x + 0.4, 1.12, 0.12, ACC); });
      for (let i = 0; i < 9; i++) s += shape(b.LF, [[0.6 + i * 0.32, 0.12], [0.8 + i * 0.32, 0.12], [0.8 + i * 0.32, 0.45], [0.6 + i * 0.32, 0.45]], '#fbbf24');
      return s;
    },
    fallbackRetry(c) { // a unit with a circular arrow: try again
      const b = box(0.4, 0.4, 0, 3.2, 3.2, 1.0, c), T = b.T, a0 = 0.7, arc = [];
      for (let i = 0; i <= 12; i++) { const a = a0 + (Math.PI * 1.65 * i) / 12; arc.push(T(2 + 1.05 * Math.cos(a), 2 + 1.05 * Math.sin(a))); }
      const e = arc[arc.length - 1], p = arc[arc.length - 2], dx = e[0] - p[0], dy = e[1] - p[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
      return b.s + line(arc, ACC, 2.4) + poly([[e[0] + ux * 5, e[1] + uy * 5], [e[0] - uy * 4, e[1] + ux * 4], [e[0] + uy * 4, e[1] - ux * 4]], ACC);
    },
    budgetGate(c) { // a stack of coins on a plinth
      let s = box(0.3, 0.3, 0, 3.4, 3.4, 0.4, c).s;
      [0.4, 0.85, 1.3, 1.75].forEach((z, i) => { s += cyl(2 + (i % 2) * 0.12, 2, z, 1.25, 0.4, GOLD); });
      const [tx, ty] = P(2.12, 2, 2.15);
      return s + `<text x="${f(tx)}" y="${f(ty + 3)}" text-anchor="middle" font-size="11" font-weight="700" fill="${GOLD.ink}" font-family="Arial,sans-serif">$</text>`;
    },
    evalJudge(c) { // a clipboard-style unit with ticks
      const b = box(0.3, 0.3, 0, 3.4, 3.4, 1.5, c);
      let s = b.s + shape(b.LF, [[0.6, 0.2], [3.4, 0.2], [3.4, 1.3], [0.6, 1.3]], WHITE);
      [0.95, 0.6, 0.25].forEach((z, i) => { s += line([b.LF(0.8, z + 0.12), b.LF(0.95, z), b.LF(1.2, z + 0.22)], i === 2 ? '#ef4444' : OK, 1.8) + shape(b.LF, [[1.5, z + 0.04], [3.1, z + 0.04], [3.1, z + 0.14], [1.5, z + 0.14]], '#94a3b8'); });
      return s;
    },
    humanInLoop(c) { // a person on a plinth
      return box(0.4, 0.4, 0, 3.2, 3.2, 0.5, c).s + cyl(2, 2, 0.5, 1.0, 1.4, c) + sphere(2, 2, 2.55, 0.85, SKIN)
        + `<path d="M${f(P(2, 2, 2.55)[0] - 7.6)} ${f(P(2, 2, 2.55)[1] - 2)} A7.6 7.6 0 0 1 ${f(P(2, 2, 2.55)[0] + 7.6)} ${f(P(2, 2, 2.55)[1] - 2)} Q${f(P(2, 2, 2.55)[0])} ${f(P(2, 2, 2.55)[1] - 6)} ${f(P(2, 2, 2.55)[0] - 7.6)} ${f(P(2, 2, 2.55)[1] - 2)}Z" fill="#374151"/>`;
    },
    fineTunedModel(c) { // a unit with a gem: tuned for one job
      const b = box(0.4, 0.4, 0, 3.2, 3.2, 1.5, c), [cx, cy] = P(2, 2, 2.35);
      return b.s + front(b, c) + poly([[cx, cy - 14], [cx + 10, cy - 4], [cx, cy + 8], [cx - 10, cy - 4]], PINK, edge(PINK))
        + poly([[cx, cy - 14], [cx + 10, cy - 4], [cx, cy - 4]], '#fff', 'opacity=".45"') + poly([[cx, cy - 4], [cx + 10, cy - 4], [cx, cy + 8]], '#db2777', 'opacity=".35"');
    },
    batchProcessor(c) { // crates waiting for the next batch
      let s = '';
      [[1.9, 0.2], [0.2, 2.0], [2.1, 2.0]].forEach(([x, y], i) => {
        const b = box(x, y, 0, 1.85, 1.85, 1.3, CARD, true);
        s += b.s + shape(b.T, [[x + 0.75, y], [x + 1.1, y], [x + 1.1, y + 1.85], [x + 0.75, y + 1.85]], WHITE, 'opacity=".65"');
        if (i === 0) s += dot(b.LF, x + 0.92, 0.65, 0.22, ACC);
      });
      return s;
    },
    agentOrchestrator(c) { // a hub directing three workers
      let s = box(0.3, 0.3, 0, 3.4, 3.4, 0.5, c).s;
      const hubs = [[0.5, 2.5], [2.65, 2.5], [1.6, 0.45]];
      s += hubs.map(([x, y]) => line([P(2, 1.9, 1.7), P(x + 0.45, y + 0.45, 0.9)], ACC, 1.6)).join('');
      hubs.forEach(([x, y]) => { const b = box(x, y, 0.5, 0.9, 0.9, 0.7, c, true); s += b.s + dot(b.LF, x + 0.45, 0.85, 0.12, ACC); });
      return s + sphere(2, 1.9, 1.7, 0.95, c.base);
    },
    subAgent(c) { // a little robot
      const body = box(1.0, 1.0, 0, 2.0, 2.0, 1.3, c), head = box(1.15, 1.15, 1.3, 1.7, 1.7, 1.0, tones(shade(c.base, 0.12)));
      return body.s + dot(body.LF, 1.6, 0.65, 0.13, ACC) + dot(body.LF, 2.1, 0.65, 0.13, WARM) + head.s
        + shape(head.LF, [[1.45, 1.9], [1.85, 1.9], [1.85, 2.2], [1.45, 2.2]], ACC) + shape(head.LF, [[2.15, 1.9], [2.55, 1.9], [2.55, 2.2], [2.15, 2.2]], ACC)
        + box(1.92, 1.92, 2.3, 0.2, 0.2, 0.7, SILVER, true).s + sphere(2.02, 2.02, 3.1, 0.28, WARM);
    },
    responseSink(c) { // a finish flag on a plinth
      const m = plateMap(0.7);
      let s = box(0.2, 0.2, 0, 3.6, 3.6, 0.6, c).s + box(0.6, 0.6, 0.6, 0.2, 0.2, 3.2, SILVER, true).s;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        const x = 0.85 + i * 0.5, z = 2.6 + j * 0.42;
        s += shape(m, [[x, z], [x + 0.5, z], [x + 0.5, z + 0.42], [x, z + 0.42]], (i + j) % 2 ? DARK : WHITE);
      }
      return s;
    },
  };

  // ---------- public ----------
  function icon3d(def, px) {
    const size = px || 48, build = ICONS[def.id];
    const c = tones(SIM.CATEGORY_COLORS[def.category] || '#64748b');
    const art = build ? build(c) : box(0.4, 0.4, 0, 3.2, 3.2, 1.4, c).s;
    return `<svg class="icon3d" width="${size}" height="${Math.round((size * 84) / 96)}" viewBox="0 0 96 84" aria-hidden="true" focusable="false">`
      + `<ellipse cx="48" cy="57" rx="34" ry="12" fill="#000" opacity=".28"/>${art}</svg>`;
  }
  SIM.icon3d = icon3d;
  // icon + label as markup (labels come from our own definitions, never user input)
  SIM.iconLabel = (def, px) => `<span class="icowrap">${icon3d(def, px)}<span class="icotext">${def.label}</span></span>`;
})();
