(function () {
  const NAMES = ["小满","青团","赤鲤","墨白","荷叶","铃音","黄金","白金","丹顶","青花","胭脂","素雪","金鳞","碧波","雨荷","云锦","琥珀","月白","朱砂","松烟","桃夭","竹青","兰舟","星河","晚霞","朝露","桂花","荔枝","石榴","银杏","枫桥","春水","秋波","夏至","冬雪","锦书","红豆","白露","谷雨","芒种","霜降","惊蛰"];
  const PATTERNS = ["kohaku", "kohaku", "kohaku", "tancho", "orange", "kohaku", "sanke", "gold", "white", "orange"];

  const state = {
    effect: "clear",
    wind: 0,
    tz: "Asia/Shanghai",
    hour: 12,
    clockAt: 0,
    timeMode: "auto",
    moonMode: "auto",
  };

  let canvas, ctx, W = 0, H = 0, dpr = 1;
  let bg;
  let surface;
  let last = 0;
  const fishes = [];
  const turtles = [];
  const butterflies = [];
  const groups = [0, 1, 2].map(() => ({ x: 400, y: 300, tx: 400, ty: 300 }));
  let pellets = [];
  let ripples = [];
  let floats = [];
  let drops = [];
  let flakes = [];
  let motes = [];
  let bubbles = [];
  let frogs = [];
  let splashes = [];
  let scares = [];
  let leaves = [];
  let fog = [];
  let nextNum = 1;
  let onEat = null;
  let onRoster = null;
  const mouse = { x: -9999, y: -9999, inside: false, movedAt: 0 };
  let tipEl, hoverFish = null;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  let VIEW = 0.42;
  const TURTLE_LEN = 70;

  const WATER = [
    [0.02, 0.03],
    [0.98, 0.03],
    [0.98, 0.97],
    [0.02, 0.97],
  ];

  function bedMap() {
    const iw = bedPhoto.naturalWidth || 1600;
    const ih = bedPhoto.naturalHeight || 900;
    const scale = Math.max(W / iw, H / ih) || 1;
    return {
      ox: (W - iw * scale) / 2,
      oy: (H - ih * scale) / 2,
      scale: scale,
      iw: iw,
      ih: ih,
    };
  }

  function toImage(x, y) {
    const m = bedMap();
    return {
      u: (x - m.ox) / (m.iw * m.scale),
      v: (y - m.oy) / (m.ih * m.scale),
    };
  }

  function toScreen(u, v) {
    const m = bedMap();
    return { x: m.ox + u * m.iw * m.scale, y: m.oy + v * m.ih * m.scale };
  }

  function inWater(x, y) {
    const p = toImage(x, y);
    let inside = false;
    for (let i = 0, j = WATER.length - 1; i < WATER.length; j = i++) {
      const xi = WATER[i][0];
      const yi = WATER[i][1];
      const xj = WATER[j][0];
      const yj = WATER[j][1];
      const hit = ((yi > p.v) !== (yj > p.v)) && (p.u < ((xj - xi) * (p.v - yi)) / ((yj - yi) || 1e-6) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }

  function waterCenter() {
    let u = 0;
    let v = 0;
    WATER.forEach((p) => { u += p[0]; v += p[1]; });
    return toScreen(u / WATER.length, v / WATER.length);
  }

  function pondBounds() {
    const x = Math.max(120, W * 0.08);
    const y = Math.max(100, H * 0.08);
    return { x0: x, y0: y, x1: Math.max(x + 1, W - x), y1: Math.max(y + 1, H - y) };
  }

  function placeInWater(rand) {
    const b = pondBounds();
    for (let i = 0; i < 40; i++) {
      const x = b.x0 + rand() * (b.x1 - b.x0);
      const y = b.y0 + rand() * (b.y1 - b.y0);
      if (inWater(x, y)) return { x: x, y: y };
    }
    return waterCenter();
  }

  function bodyPad(obj) {
    if (obj.kind === "turtle") return VIEW * TURTLE_LEN * obj.scale * 0.8;
    if (obj.kind === "frog") return frogSize() * obj.size * 2.6;
    return 82 * VIEW * obj.scale;
  }

  function roomFor(x, y, pad) {
    return x > pad && x < W - pad && y > pad && y < H - pad && inWater(x, y);
  }

  function edgePush(obj) {
    const pad = bodyPad(obj);
    const zone = pad + 70;
    let px = 0;
    let py = 0;
    if (obj.x < zone) px += (zone - obj.x) / 70;
    if (obj.x > W - zone) px -= (obj.x - (W - zone)) / 70;
    if (obj.y < zone) py += (zone - obj.y) / 70;
    if (obj.y > H - zone) py -= (obj.y - (H - zone)) / 70;
    return { x: px, y: py };
  }

  function moveInWater(obj, nx, ny) {
    const pad = bodyPad(obj);
    if (roomFor(nx, ny, pad)) {
      obj.x = nx;
      obj.y = ny;
      return;
    }
    if (roomFor(nx, obj.y, pad)) {
      obj.x = nx;
      return;
    }
    if (roomFor(obj.x, ny, pad)) {
      obj.y = ny;
      return;
    }
    const c = waterCenter();
    if (!roomFor(obj.x, obj.y, pad)) {
      obj.x += (c.x - obj.x) * 0.12;
      obj.y += (c.y - obj.y) * 0.12;
    }
    obj.a = Math.atan2(c.y - obj.y, c.x - obj.x);
  }

  function pushWake(x, y, angle, strength) {
    if (!inWater(x, y) || coverAt(x, y) || ripples.length > 70) return;
    ripples.push({ x: x, y: y, r: 1.6, a: strength, rot: angle, grow: 14 });
  }

  let cover = null;
  let seats = [];
  let pondBase = null;
  let leafPieces = [];
  let leafRest = null;
  let leafId = null;
  let leafS = 0;
  let rings = [];
  let rainBits = [];
  let rainTex = null;
  let flash = 0;
  let flashIn = 9;
  let snowAcc = null;
  let snowDraw = null;
  let snowShade = null;
  let snowLevel = 0;
  let snowTick = 0;
  let flakeSprite = null;
  let flakeShadow = null;
  let snowField = null;

  function findSeats(m, pink, mw, mh) {
    const d = new Float32Array(m.length);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = y * mw + x;
        let near = false;
        for (let k = -3; k <= 3 && !near; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= mh) continue;
          for (let j = -3; j <= 3; j++) {
            const xx = x + j;
            if (xx >= 0 && xx < mw && pink[yy * mw + xx]) { near = true; break; }
          }
        }
        d[i] = m[i] && !near ? 1e6 : 0;
      }
    }
    const at = (x, y) => (x < 0 || y < 0 || x >= mw || y >= mh ? 0 : d[y * mw + x]);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = y * mw + x;
        if (!d[i]) continue;
        d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
      }
    }
    for (let y = mh - 1; y >= 0; y--) {
      for (let x = mw - 1; x >= 0; x--) {
        const i = y * mw + x;
        if (!d[i]) continue;
        d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
      }
    }
    const cand = [];
    for (let y = 1; y < mh - 1; y++) {
      for (let x = 1; x < mw - 1; x++) {
        const v = d[y * mw + x];
        if (v < 7) continue;
        let peak = true;
        for (let k = -1; k <= 1 && peak; k++) {
          for (let j = -1; j <= 1; j++) {
            if ((j || k) && at(x + j, y + k) > v) { peak = false; break; }
          }
        }
        if (peak) cand.push({ x: x, y: y, r: v });
      }
    }
    cand.sort((a, b) => b.r - a.r);
    const kept = [];
    cand.forEach((c) => {
      if (kept.length >= 40) return;
      if (kept.some((k) => Math.hypot(k.x - c.x, k.y - c.y) < Math.max(k.r, c.r) * 1.3 + 4)) return;
      kept.push(c);
    });
    const sx = W / mw;
    return kept.map((k) => ({ x: (k.x + 0.5) * sx, y: (k.y + 0.5) * (H / mh), r: k.r * sx, frog: null }));
  }

  function coverAt(x, y) {
    if (!cover) return false;
    const ix = Math.floor((x / W) * cover.w);
    const iy = Math.floor((y / H) * cover.h);
    if (ix < 0 || iy < 0 || ix >= cover.w || iy >= cover.h) return false;
    return cover.m[iy * cover.w + ix] === 1;
  }

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function buildPondBase() {
    const w = Math.round(W / 2);
    const h = Math.round(H / 2);
    const half = makeCanvas(w, h);
    const g = half.getContext("2d");
    g.drawImage(bg, 0, 0, w, h);
    g.globalCompositeOperation = "destination-out";
    g.drawImage(cover.canvas, 0, 0, w, h);
    [2, 4, 8, 16, 32, 64].forEach((r) => {
      const tmp = makeCanvas(w, h);
      const tg = tmp.getContext("2d");
      tg.filter = "blur(" + r + "px)";
      tg.drawImage(half, 0, 0);
      g.globalCompositeOperation = "destination-over";
      g.drawImage(tmp, 0, 0);
    });
    g.fillStyle = "#4fc2b4";
    g.fillRect(0, 0, w, h);
    pondBase = makeCanvas(W, H);
    const pg = pondBase.getContext("2d");
    pg.drawImage(bg, 0, 0);
    pg.globalCompositeOperation = "destination-out";
    pg.drawImage(cover.canvas, 0, 0, W, H);
    pg.globalCompositeOperation = "destination-over";
    pg.drawImage(half, 0, 0, W, H);
  }

  function buildLeafPieces() {
    const { m, w: mw, h: mh } = cover;
    const d = new Float32Array(m.length);
    for (let i = 0; i < m.length; i++) d[i] = m[i] ? 1e6 : 0;
    const at = (x, y) => (x < 0 || y < 0 || x >= mw || y >= mh ? 0 : d[y * mw + x]);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = y * mw + x;
        if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
      }
    }
    for (let y = mh - 1; y >= 0; y--) {
      for (let x = mw - 1; x >= 0; x--) {
        const i = y * mw + x;
        if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
      }
    }
    const cand = [];
    for (let y = 1; y < mh - 1; y++) {
      for (let x = 1; x < mw - 1; x++) {
        const v = d[y * mw + x];
        if (v < 2.5) continue;
        let peak = true;
        for (let k = -1; k <= 1 && peak; k++) {
          for (let j = -1; j <= 1; j++) {
            if ((j || k) && at(x + j, y + k) > v) { peak = false; break; }
          }
        }
        if (peak) cand.push({ x: x, y: y, r: v });
      }
    }
    cand.sort((a, b) => b.r - a.r);
    const centers = [];
    cand.forEach((c) => {
      if (!centers.some((k) => Math.hypot(k.x - c.x, k.y - c.y) < Math.max(k.r, c.r) * 0.95)) centers.push(c);
    });

    const label = new Int32Array(m.length).fill(-1);
    const score = new Float32Array(m.length).fill(1e9);
    centers.forEach((c, ci) => {
      const reach = Math.ceil(c.r * 1.6);
      for (let y = Math.max(0, c.y - reach); y <= Math.min(mh - 1, c.y + reach); y++) {
        for (let x = Math.max(0, c.x - reach); x <= Math.min(mw - 1, c.x + reach); x++) {
          const i = y * mw + x;
          if (!m[i]) continue;
          const s = Math.hypot(x - c.x, y - c.y) / c.r;
          if (s < 1.6 && s < score[i]) { score[i] = s; label[i] = ci; }
        }
      }
    });
    const queue = new Int32Array(m.length);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < m.length; i++) if (label[i] >= 0) queue[tail++] = i;
    while (head < tail) {
      const i = queue[head++];
      const x = i % mw;
      const near = [x > 0 ? i - 1 : -1, x < mw - 1 ? i + 1 : -1, i - mw, i + mw];
      for (let k = 0; k < 4; k++) {
        const j = near[k];
        if (j < 0 || j >= m.length || !m[j] || label[j] >= 0) continue;
        label[j] = label[i];
        queue[tail++] = j;
      }
    }

    const boxes = centers.map(() => ({ x0: 1e9, y0: 1e9, x1: -1, y1: -1, n: 0 }));
    for (let i = 0; i < m.length; i++) {
      const l = label[i];
      if (l < 0) continue;
      const b = boxes[l];
      const x = i % mw;
      const y = (i / mw) | 0;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      b.n++;
    }
    const sx = W / mw;
    const sy = H / mh;
    leafId = label;
    leafPieces = centers.map((c, ci) => {
      const b = boxes[ci];
      if (!b.n) return null;
      const pad = 2;
      const bx = Math.max(0, b.x0 - pad);
      const by = Math.max(0, b.y0 - pad);
      const bw = Math.min(mw - 1, b.x1 + pad) - bx + 1;
      const bh = Math.min(mh - 1, b.y1 + pad) - by + 1;
      const mc = makeCanvas(bw, bh);
      const mg = mc.getContext("2d");
      const img = mg.createImageData(bw, bh);
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const gx = bx + x;
          const gy = by + y;
          let hit = false;
          for (let k = -1; k <= 1 && !hit; k++) {
            for (let j = -1; j <= 1; j++) {
              const xx = gx + j;
              const yy = gy + k;
              if (xx >= 0 && yy >= 0 && xx < mw && yy < mh && label[yy * mw + xx] === ci) { hit = true; break; }
            }
          }
          if (hit) img.data[(y * bw + x) * 4 + 3] = 255;
        }
      }
      mg.putImageData(img, 0, 0);
      const ox = bx * sx;
      const oy = by * sy;
      const pc = makeCanvas(bw * sx, bh * sy);
      const pg = pc.getContext("2d");
      pg.drawImage(surface, ox, oy, pc.width, pc.height, 0, 0, pc.width, pc.height);
      pg.globalCompositeOperation = "destination-in";
      pg.imageSmoothingEnabled = true;
      pg.drawImage(mc, 0, 0, pc.width, pc.height);
      const area = b.n * sx * sy;
      return {
        canvas: pc,
        ox: ox,
        oy: oy,
        cx: (c.x + 0.5) * sx,
        cy: (c.y + 0.5) * sy,
        k: clamp(Math.sqrt(2400 / area), 0.5, 1.4),
        p: Math.random() * Math.PI * 2,
        dx: 0,
        dy: 0,
        rot: 0,
        lift: 0,
        bob: 0,
      };
    });
    const rest = makeCanvas(mw, mh);
    const rg = rest.getContext("2d");
    const ri = rg.createImageData(mw, mh);
    for (let i = 0; i < m.length; i++) if (m[i] && label[i] < 0) ri.data[i * 4 + 3] = 255;
    rg.putImageData(ri, 0, 0);
    leafRest = makeCanvas(W, H);
    const lg = leafRest.getContext("2d");
    lg.drawImage(surface, 0, 0);
    lg.globalCompositeOperation = "destination-in";
    lg.drawImage(rest, 0, 0, W, H);
    seats.forEach((s) => { s.leaf = leafAt(s.x, s.y); });
  }

  function leafAt(x, y) {
    if (!leafId || !cover) return -1;
    const ix = Math.floor((x / W) * cover.w);
    const iy = Math.floor((y / H) * cover.h);
    if (ix < 0 || iy < 0 || ix >= cover.w || iy >= cover.h) return -1;
    return leafId[iy * cover.w + ix];
  }

  function leafMove(idx, x, y) {
    const pc = idx >= 0 ? leafPieces[idx] : null;
    if (!pc || leafS < 0.01) return { x: x, y: y, rot: 0 };
    const c = Math.cos(pc.rot);
    const s = Math.sin(pc.rot);
    const rx = x - pc.cx;
    const ry = y - pc.cy;
    return { x: pc.cx + pc.dx + rx * c - ry * s, y: pc.cy + pc.dy + rx * s + ry * c, rot: pc.rot };
  }

  function leafTarget() {
    if (state.effect === "snow") return 0;
    const base = { wind: 1, rain: 0.42, drizzle: 0.16 }[state.effect] || 0;
    return Math.max(base, clamp((state.wind - 18) / 45, 0, 0.6));
  }

  function updateLeaves(dt, t) {
    leafS += (leafTarget() - leafS) * Math.min(1, dt * 0.9);
    if (leafS < 0.01) return;
    const S = leafS;
    leafPieces.forEach((pc) => {
      if (!pc) return;
      const gust = 0.5 + 0.5 * Math.sin(t * 1.15 - pc.cx * 0.0042 - pc.cy * 0.0016);
      const g2 = gust * gust;
      pc.bob = Math.max(0, pc.bob - dt * 2.4);
      const flutter = Math.sin(t * (2.4 + pc.k) + pc.p);
      pc.dx = S * pc.k * (2 + 7 * g2 + 2.2 * flutter);
      pc.dy = S * pc.k * (1.8 * Math.sin(t * 1.9 + pc.p * 1.7) + 1.4 * g2) + pc.bob * Math.sin(t * 22 + pc.p) * 0.9;
      pc.rot = S * pc.k * 0.08 * Math.sin(t * 2.1 + pc.p) * (0.4 + g2) + pc.bob * 0.012 * Math.sin(t * 19 + pc.p);
      pc.lift = S * clamp((g2 - 0.45) * 2, 0, 1) * Math.max(0, flutter);
    });
  }

  function drawLeaves() {
    if (leafRest) ctx.drawImage(leafRest, 0, 0, W, H);
    ctx.save();
    leafPieces.forEach((pc) => {
      if (!pc) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(pc.cx + pc.dx, pc.cy + pc.dy);
      ctx.rotate(pc.rot);
      if (pc.lift > 0.03) ctx.scale(1 - pc.lift * 0.05, 1 + pc.lift * 0.015);
      const x = pc.ox - pc.cx;
      const y = pc.oy - pc.cy;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(pc.canvas, x, y);
      if (pc.lift > 0.03) {
        ctx.globalAlpha = pc.lift * 0.32;
        ctx.globalCompositeOperation = "screen";
        ctx.drawImage(pc.canvas, x, y);
      }
    });
    ctx.restore();
  }

  function dropSmall(m, mw, target, maxSize) {
    const seen = new Uint8Array(m.length);
    const queue = new Int32Array(m.length);
    for (let s = 0; s < m.length; s++) {
      if (seen[s] || m[s] !== target) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      seen[s] = 1;
      while (head < tail) {
        const i = queue[head++];
        const x = i % mw;
        const near = [x > 0 ? i - 1 : -1, x < mw - 1 ? i + 1 : -1, i - mw, i + mw];
        for (let k = 0; k < 4; k++) {
          const j = near[k];
          if (j < 0 || j >= m.length || seen[j] || m[j] !== target) continue;
          seen[j] = 1;
          queue[tail++] = j;
        }
      }
      if (tail < maxSize) for (let k = 0; k < tail; k++) m[queue[k]] = 1 - target;
    }
  }

  function buildCover() {
    const mw = 640;
    const mh = Math.max(1, Math.round((mw * H) / W));
    const small = document.createElement("canvas");
    small.width = mw;
    small.height = mh;
    const sg = small.getContext("2d");
    sg.drawImage(bg, 0, 0, mw, mh);
    const px = sg.getImageData(0, 0, mw, mh).data;
    let m = new Uint8Array(mw * mh);
    const pink = new Uint8Array(mw * mh);
    for (let i = 0; i < m.length; i++) {
      const r = px[i * 4];
      const g = px[i * 4 + 1];
      const b = px[i * 4 + 2];
      if (r - g > 28 && r > 170) pink[i] = 1;
      if ((g - b > 66 && g > 110) || pink[i]) m[i] = 1;
    }
    dropSmall(m, mw, 0, mw * mh * 0.004);
    dropSmall(m, mw, 1, 60);
    seats = findSeats(m, pink, mw, mh);
    frogs.forEach((fr) => { fr.seat = null; fr.goal = null; fr.jump = null; fr.state = "lost"; });
    const grown = new Uint8Array(m.length);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = y * mw + x;
        grown[i] = m[i] || (x > 0 && m[i - 1]) || (x < mw - 1 && m[i + 1]) || (y > 0 && m[i - mw]) || (y < mh - 1 && m[i + mw]) ? 1 : 0;
      }
    }
    m = grown;
    const alpha = sg.createImageData(mw, mh);
    for (let i = 0; i < m.length; i++) {
      alpha.data[i * 4 + 3] = m[i] ? 255 : 0;
    }
    sg.putImageData(alpha, 0, 0);
    cover = { m: m, w: mw, h: mh, canvas: small, pink: pink };
  }

  function shade(hex, amt) {
    const n = parseInt(String(hex).replace("#", ""), 16);
    if (!Number.isFinite(n)) return hex;
    const r = clamp((n >> 16) + amt, 0, 255);
    const g = clamp(((n >> 8) & 255) + amt, 0, 255);
    const b = clamp((n & 255) + amt, 0, 255);
    return "rgb(" + r + "," + g + "," + b + ")";
  }
  function randRange(rand, a, b) { return a + (b - a) * rand(); }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    VIEW = clamp(W / 1920, 0.6, 1.4) * 0.42;
    bakeBackground();
    groups.forEach((g, i) => {
      const b = pondBounds();
      if (!g.ready) {
        g.x = b.x0 + ((i + 0.5) / groups.length) * (b.x1 - b.x0);
        g.y = b.y0 + (0.25 + (i % 2) * 0.5) * (b.y1 - b.y0);
        g.tx = g.x;
        g.ty = g.y;
        g.ready = true;
      } else {
        g.x = clamp(g.x, b.x0, b.x1);
        g.y = clamp(g.y, b.y0, b.y1);
        g.tx = clamp(g.tx, b.x0, b.x1);
        g.ty = clamp(g.ty, b.y0, b.y1);
      }
    });
  }

  let bedPhoto = new Image();
  bedPhoto.onload = function () {
    if (W) bakeBackground();
  };
  bedPhoto.src = "bed.jpg";

  function bakeBackground() {
    bg = document.createElement("canvas");
    bg.width = Math.max(1, W);
    bg.height = Math.max(1, H);
    const g = bg.getContext("2d");
    g.fillStyle = "#8d8474";
    g.fillRect(0, 0, W, H);
    if (bedPhoto.complete && bedPhoto.naturalWidth) {
      const scale = Math.max(W / bedPhoto.naturalWidth, H / bedPhoto.naturalHeight);
      const dw = bedPhoto.naturalWidth * scale;
      const dh = bedPhoto.naturalHeight * scale;
      g.drawImage(bedPhoto, (W - dw) / 2, (H - dh) / 2, dw, dh);
      buildCover();
      surface = document.createElement("canvas");
      surface.width = bg.width;
      surface.height = bg.height;
      const sg = surface.getContext("2d");
      sg.drawImage(bg, 0, 0);
      sg.globalCompositeOperation = "destination-in";
      sg.imageSmoothingEnabled = true;
      sg.drawImage(cover.canvas, 0, 0, bg.width, bg.height);
      buildPondBase();
      buildLeafPieces();
      snowAcc = makeCanvas(W / 2, H / 2);
      snowDraw = makeCanvas(W / 2, H / 2);
      snowShade = makeCanvas(W / 2, H / 2);
      snowField = null;
      return;
    }
    cover = null;
    surface = null;
  }

  function drawPebble(g, x, y, s, rand) {
    const kind = rand();
    const base = kind < 0.34 ? [132, 126, 112] : kind < 0.67 ? [98, 104, 92] : [168, 154, 128];
    g.save();
    g.translate(x, y);
    g.rotate(rand() * Math.PI);
    g.fillStyle = "rgba(50, 58, 46, 0.28)";
    g.beginPath();
    g.ellipse(s * 0.35, s * 0.45, s * 1.05, s * 0.62, 0, 0, Math.PI * 2);
    g.fill();
    const grd = g.createLinearGradient(-s, -s, s * 0.8, s * 0.8);
    grd.addColorStop(0, "rgb(" + (base[0] + 38) + "," + (base[1] + 34) + "," + (base[2] + 26) + ")");
    grd.addColorStop(0.55, "rgb(" + base[0] + "," + base[1] + "," + base[2] + ")");
    grd.addColorStop(1, "rgb(" + (base[0] - 36) + "," + (base[1] - 32) + "," + (base[2] - 28) + ")");
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(0, 0, s * (0.85 + rand() * 0.35), s * (0.55 + rand() * 0.2), 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.38)";
    g.beginPath();
    g.ellipse(-s * 0.28, -s * 0.18, s * 0.22, s * 0.12, -0.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawRock(g, x, y, s, rand) {
    g.save();
    g.translate(x, y);
    g.rotate(rand() * Math.PI * 2);
    g.fillStyle = "rgba(40, 48, 40, 0.35)";
    g.beginPath();
    g.ellipse(s * 0.12, s * 0.22, s * 0.72, s * 0.42, 0.2, 0, Math.PI * 2);
    g.fill();
    const grd = g.createLinearGradient(-s, -s * 0.4, s * 0.6, s * 0.5);
    const moss = rand() > 0.55;
    grd.addColorStop(0, moss ? "#b7c4a4" : "#d5d0c4");
    grd.addColorStop(0.45, moss ? "#7f8c72" : "#8d8a80");
    grd.addColorStop(1, "#5c6158");
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(-s * 0.7, s * 0.05);
    g.quadraticCurveTo(-s * 0.55, -s * 0.48, -s * 0.05, -s * 0.38);
    g.quadraticCurveTo(s * 0.45, -s * 0.5, s * 0.62, -s * 0.05);
    g.quadraticCurveTo(s * 0.7, s * 0.28, s * 0.15, s * 0.36);
    g.quadraticCurveTo(-s * 0.4, s * 0.42, -s * 0.7, s * 0.05);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.22)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-s * 0.35, -s * 0.18);
    g.quadraticCurveTo(-s * 0.05, -s * 0.28, s * 0.22, -s * 0.12);
    g.stroke();
    if (moss) {
      g.fillStyle = "rgba(70, 110, 62, 0.45)";
      g.beginPath();
      g.ellipse(-s * 0.1, s * 0.02, s * 0.28, s * 0.14, 0.4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function drawWeed(g, x, y, s, rand) {
    g.save();
    g.translate(x, y);
    const blades = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < blades; i++) {
      const lean = (rand() - 0.5) * 1.4;
      const h = (18 + rand() * 34) * s;
      g.strokeStyle = rand() > 0.4 ? "rgba(48, 110, 72, 0.55)" : "rgba(150, 170, 80, 0.4)";
      g.lineWidth = 1.2 + rand();
      g.beginPath();
      g.moveTo((i - blades / 2) * 4, 6);
      g.quadraticCurveTo(lean * 16, -h * 0.45, lean * 28, -h);
      g.stroke();
    }
    g.restore();
  }

  function drawLotus(g, x, y, s, rot, flower) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.fillStyle = "rgba(20, 40, 30, 0.28)";
    g.beginPath();
    g.ellipse(6, 10, s * 0.92, s * 0.72, 0.2, 0, Math.PI * 2);
    g.fill();
    const pad = g.createRadialGradient(-s * 0.25, -s * 0.2, s * 0.08, 0, 0, s);
    pad.addColorStop(0, "#6f8f58");
    pad.addColorStop(0.5, "#3d6244");
    pad.addColorStop(1, "#1d3b2c");
    g.fillStyle = pad;
    g.beginPath();
    for (let i = 0; i <= 42; i++) {
      const a = (i / 42) * Math.PI * 2;
      const notch = (a > 0.15 && a < 0.72) ? 0.78 : 1;
      const wobble = 1 + Math.sin(a * 6 + rot) * 0.045;
      const rr = s * notch * wobble;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr * 0.88;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(210, 230, 170, 0.35)";
    g.lineWidth = 1;
    for (let i = 0; i < 11; i++) {
      const a = -0.2 + i * 0.48;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * s * 0.92, Math.sin(a) * s * 0.78);
      g.stroke();
    }
    g.strokeStyle = "rgba(18, 50, 30, 0.45)";
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(0, 0, s, s * 0.86, 0, 0.42, Math.PI * 2 - 0.2);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.28)";
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(-s * 0.15, -s * 0.18, s * 0.45, s * 0.22, -0.6, 0.2, 1.4);
    g.stroke();
    if (flower) {
      g.save();
      g.translate(s * 0.05, -s * 0.02);
      g.fillStyle = "rgba(20, 30, 20, 0.25)";
      g.beginPath();
      g.ellipse(4, 8, s * 0.28, s * 0.12, 0, 0, Math.PI * 2);
      g.fill();
      for (let layer = 0; layer < 2; layer++) {
        const n = layer === 0 ? 8 : 6;
        const rad = s * (layer === 0 ? 0.4 : 0.26);
        for (let i = 0; i < n; i++) {
          g.save();
          g.rotate((Math.PI * 2 * i) / n + layer * 0.4);
          const petal = g.createLinearGradient(0, 0, 0, -rad);
          petal.addColorStop(0, layer ? "#fff6f8" : "#f3b7c6");
          petal.addColorStop(1, layer ? "#f7d5de" : "#e07f98");
          g.fillStyle = petal;
          g.beginPath();
          g.ellipse(0, -rad * 0.55, rad * 0.24, rad * 0.55, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      }
      g.fillStyle = "#e6c15a";
      g.beginPath();
      g.arc(0, 0, s * 0.09, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.restore();
  }

  function makeFish(rand) {
    const pattern = PATTERNS[Math.floor(rand() * PATTERNS.length)];
    const palette = {
      kohaku: ["#fbf8f2", "#ee5a24", "#fffaf4"],
      tancho: ["#fcfaf6", "#e8441e", "#fffaf4"],
      sanke: ["#faf6ef", "#ec5826", "#fffaf4"],
      orange: ["#f4782c", "#ffb06a", "#ffd9b8"],
      gold: ["#f4b23c", "#ffe08a", "#ffecc4"],
      white: ["#fcfbf8", "#f7c39c", "#ffffff"],
    }[pattern];
    const scale = randRange(rand, 0.8, 1.2);
    const spots = [];
    const ink = [];
    const blob = (x, y, rx, ry, rot) => ({ x, y, rx, ry, rot, seed: rand() * 10 });
    if (pattern === "kohaku" || pattern === "sanke") {
      spots.push(blob(randRange(rand, 30, 34), randRange(rand, -1.5, 1.5), randRange(rand, 12, 15), randRange(rand, 10, 13), 0));
      const n = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        spots.push(blob(randRange(rand, -22, 14), randRange(rand, -4, 4), randRange(rand, 9, 15), randRange(rand, 10, 15), randRange(rand, -0.5, 0.5)));
      }
    } else if (pattern === "tancho") {
      spots.push(blob(31, 0, 6.8, 6.8, 0));
    } else if (pattern === "white") {
      spots.length = 0;
    } else {
      spots.push(blob(randRange(rand, 4, 16), 0, randRange(rand, 12, 18), randRange(rand, 3, 5), 0));
    }
    if (pattern === "sanke") {
      const n = 3 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        ink.push(blob(randRange(rand, -24, 20), randRange(rand, -9, 9), randRange(rand, 1.6, 3.6), randRange(rand, 1.4, 3), rand() * 3));
      }
    }
    const num = nextNum++;
    const fish = {
      id: "f" + num,
      num,
      name: NAMES[(num - 1) % NAMES.length],
      custom: false,
      pattern,
      color: palette[1],
      body: palette[0],
      bodyHi: "#ffffff",
      tail: palette[0],
      fin: palette[2],
      spots,
      ink,
      scale,
      x: rand() * 800,
      y: rand() * 600,
      a: rand() * Math.PI * 2,
      baseSpeed: randRange(rand, 42, 78) * (scale > 1.1 ? 0.82 : 1),
      phase: rand() * Math.PI * 2,
      wag: rand(),
      wander: 0,
      group: Math.floor(rand() * 3),
      eaten: 0,
      flash: 0,
      boost: 0,
    };
    buildKoiSprite(fish);
    return fish;
  }

  const KOI = { x0: -78, x1: 48, hh: 28, res: 3 };

  function rgba(hex, a) {
    const n = parseInt(String(hex).replace("#", ""), 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  function koiBodyPath(g) {
    if (g.beginPath) g.beginPath();
    g.moveTo(47, 0);
    g.bezierCurveTo(47, -4.8, 43, -9.2, 35, -10.8);
    g.bezierCurveTo(26, -12.2, 14, -12, 2, -10);
    g.bezierCurveTo(-10, -7.8, -22, -4.4, -31, -2.6);
    g.lineTo(-31, 2.6);
    g.bezierCurveTo(-22, 4.4, -10, 7.8, 2, 10);
    g.bezierCurveTo(14, 12, 26, 12.2, 35, 10.8);
    g.bezierCurveTo(43, 9.2, 47, 4.8, 47, 0);
    g.closePath();
  }

  function koiTailPath(g) {
    if (g.beginPath) g.beginPath();
    g.moveTo(-28, -2.8);
    g.bezierCurveTo(-36, -4, -46, -10, -58, -19);
    g.bezierCurveTo(-63, -22.5, -70, -21.5, -68, -16);
    g.bezierCurveTo(-65, -10, -59, -5, -53, 0);
    g.bezierCurveTo(-59, 5, -65, 10, -68, 16);
    g.bezierCurveTo(-70, 21.5, -63, 22.5, -58, 19);
    g.bezierCurveTo(-46, 10, -36, 4, -28, 2.8);
    g.closePath();
  }

  function blobPath(g, s) {
    g.beginPath();
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const k = 1 + 0.16 * Math.sin(a * 3 + s.seed) + 0.09 * Math.sin(a * 5 + s.seed * 2.3);
      const px = Math.cos(a) * s.rx * k;
      const py = Math.sin(a) * s.ry * k;
      const x = s.x + px * Math.cos(s.rot) - py * Math.sin(s.rot);
      const y = s.y + px * Math.sin(s.rot) + py * Math.cos(s.rot);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  }

  function buildKoiSprite(f, paint, noShadow) {
    const BW = KOI.x1 - KOI.x0;
    const R = KOI.res;
    const c = document.createElement("canvas");
    c.width = (KOI.x1 - KOI.x0) * R;
    c.height = KOI.hh * 2 * R;
    const g = c.getContext("2d");
    g.scale(R, R);
    g.translate(-KOI.x0, KOI.hh);

    g.fillStyle = rgba(f.fin, 0.55);
    [-1, 1].forEach((side) => {
      g.beginPath();
      g.ellipse(-10, side * 10.5, 6.5, 2.6, side * 0.55, 0, Math.PI * 2);
      g.fill();
    });

    const tg = g.createLinearGradient(-28, 0, -70, 0);
    const warm = f.pattern === "orange" || f.pattern === "gold";
    tg.addColorStop(0, rgba(warm ? f.body : f.fin, 0.92));
    tg.addColorStop(0.18, warm ? rgba(f.body, 0.7) : rgba(f.color, f.pattern === "white" ? 0.05 : 0.22));
    tg.addColorStop(0.5, rgba(f.fin, 0.5));
    tg.addColorStop(1, rgba(f.fin, 0.16));
    g.fillStyle = tg;
    g.filter = "blur(0.8px)";
    koiTailPath(g);
    g.fill();
    g.filter = "none";
    if (paint) {
      g.save();
      koiTailPath(g);
      g.clip();
      g.globalAlpha = 0.6;
      g.drawImage(paint, KOI.x0, -KOI.hh, BW, KOI.hh * 2);
      g.restore();
    }
    g.strokeStyle = "rgba(255,255,255,0.38)";
    g.lineWidth = 0.3;
    for (let k = -6; k <= 6; k++) {
      g.beginPath();
      g.moveTo(-29, k * 0.4);
      g.quadraticCurveTo(-42, k * 1.9, -54 - Math.abs(k) * 2, k * 3.1);
      g.stroke();
    }
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 0.35;
    koiTailPath(g);
    g.stroke();

    g.save();
    koiBodyPath(g);
    g.clip();
    g.fillStyle = f.body;
    g.fillRect(-40, -20, 90, 40);
    g.filter = "blur(1.2px)";
    f.spots.forEach((s) => {
      const sg = g.createRadialGradient(s.x - s.rx * 0.25, s.y - s.ry * 0.3, 0.5, s.x, s.y, Math.max(s.rx, s.ry) * 1.15);
      sg.addColorStop(0, shade(f.color, 34));
      sg.addColorStop(0.6, f.color);
      sg.addColorStop(1, shade(f.color, -14));
      g.fillStyle = sg;
      blobPath(g, s);
      g.fill();
    });
    g.fillStyle = "#28211d";
    (f.ink || []).forEach((s) => {
      blobPath(g, s);
      g.fill();
    });
    g.filter = "none";
    if (paint) g.drawImage(paint, KOI.x0, -KOI.hh, BW, KOI.hh * 2);
    for (let row = -4; row <= 4; row++) {
      for (let col = 0; col < 14; col++) {
        const x = -26 + col * 3.6 + (row % 2 ? 1.8 : 0);
        if (x > 23) continue;
        const y = row * 3.1;
        g.strokeStyle = "rgba(110,40,10,0.11)";
        g.lineWidth = 0.35;
        g.beginPath();
        g.arc(x, y, 2.3, Math.PI - 1.15, Math.PI + 1.15);
        g.stroke();
        g.strokeStyle = "rgba(255,255,255,0.2)";
        g.beginPath();
        g.arc(x + 0.45, y, 2.3, Math.PI - 1, Math.PI + 1);
        g.stroke();
      }
    }
    const side = g.createLinearGradient(0, -13, 0, 13);
    side.addColorStop(0, "rgba(20,70,70,0.30)");
    side.addColorStop(0.28, "rgba(20,70,70,0)");
    side.addColorStop(0.7, "rgba(20,70,70,0)");
    side.addColorStop(1, "rgba(20,70,70,0.36)");
    g.fillStyle = side;
    g.fillRect(-40, -20, 90, 40);
    g.strokeStyle = "rgba(60,30,20,0.12)";
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(25, -11);
    g.quadraticCurveTo(30, 0, 25, 11);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.6)";
    g.beginPath();
    g.ellipse(-4, 0, 15, 1.2, 0, 0, Math.PI * 2);
    g.fill();
    g.filter = "blur(2.5px)";
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.beginPath();
    g.ellipse(12, -4.2, 22, 2.4, -0.04, 0, Math.PI * 2);
    g.fill();
    g.filter = "none";
    g.restore();

    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 0.45;
    koiBodyPath(g);
    g.stroke();
    [-1, 1].forEach((sd) => {
      g.fillStyle = "#1d1916";
      g.beginPath();
      g.arc(38.5, sd * 6.6, 1.15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.beginPath();
      g.arc(38.8, sd * 6.6 - 0.4, 0.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(60,30,20,0.3)";
      g.beginPath();
      g.arc(43.5, sd * 3, 0.55, 0, Math.PI * 2);
      g.fill();
    });
    f.sprite = c;
    f.shadow = noShadow ? null : makeShadow(c);
    f.thumb = null;
  }

  function editorFrame(w, h) {
    const BW = KOI.x1 - KOI.x0;
    const s = Math.min(w / BW, h / (KOI.hh * 2));
    return { s: s, ox: (w - BW * s) / 2, oy: (h - KOI.hh * 2 * s) / 2 };
  }

  function koiClipPath(w, h) {
    const fr = editorFrame(w, h);
    const m = new DOMMatrix().translate(fr.ox, fr.oy).scale(fr.s).translate(-KOI.x0, KOI.hh);
    const shape = new Path2D();
    const add = (draw) => {
      const p = new Path2D();
      draw(p);
      shape.addPath(p, m);
    };
    add(koiBodyPath);
    add(koiTailPath);
    add((p) => {
      p.ellipse(-10, 10.5, 7, 3, 0.55, 0, Math.PI * 2);
      p.ellipse(-10, -10.5, 7, 3, -0.55, 0, Math.PI * 2);
    });
    return shape;
  }

  function paintFromView(view) {
    const fr = editorFrame(view.width, view.height);
    const BW = KOI.x1 - KOI.x0;
    const c = document.createElement("canvas");
    c.width = BW * KOI.res;
    c.height = KOI.hh * 2 * KOI.res;
    c.getContext("2d").drawImage(view, fr.ox, fr.oy, BW * fr.s, KOI.hh * 2 * fr.s, 0, 0, c.width, c.height);
    return c;
  }

  function legacyPaint(img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const src = document.createElement("canvas");
    src.width = w;
    src.height = h;
    const sg = src.getContext("2d");
    sg.drawImage(img, 0, 0);
    sg.clearRect(w * 0.72 - 9, h * 0.48 - 9, 18, 18);
    const data = sg.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const mx = Math.max(px[i], px[i + 1], px[i + 2]);
      const mn = Math.min(px[i], px[i + 1], px[i + 2]);
      if (mx - mn < 28 && (px[i] + px[i + 1] + px[i + 2]) / 3 > 140) px[i + 3] = 0;
    }
    sg.putImageData(data, 0, 0);
    const BW = KOI.x1 - KOI.x0;
    const R = KOI.res;
    const c = document.createElement("canvas");
    c.width = BW * R;
    c.height = KOI.hh * 2 * R;
    const g = c.getContext("2d");
    const cy = h * 0.52;
    const ry = h * 0.28;
    const unitY = ry / 12.4;
    const sy = cy - KOI.hh * unitY;
    const sh = KOI.hh * 2 * unitY;
    const bodyL = w * 0.34;
    const bodyR = w * 0.78;
    const tailL = bodyL - 78;
    const toX = (u) => (u - KOI.x0) * R;
    g.drawImage(src, tailL, sy, bodyL - tailL, sh, toX(-70), 0, toX(-31) - toX(-70), c.height);
    g.drawImage(src, bodyL, sy, bodyR - bodyL, sh, toX(-31), 0, toX(47) - toX(-31), c.height);
    return c;
  }

  function customLook() {
    return { pattern: "custom", body: "#fbf8f2", color: "#fbf8f2", fin: "#fffaf4", spots: [], ink: [] };
  }

  function drawPectorals(g, f, flap) {
    [-1, 1].forEach((side) => {
      g.save();
      g.translate(24, side * 9.5);
      g.rotate(side * (Math.PI - 0.8 + flap * side));
      const fg = g.createLinearGradient(0, 0, 17, 0);
      fg.addColorStop(0, rgba(f.fin, 0.85));
      fg.addColorStop(1, rgba(f.fin, 0.22));
      g.fillStyle = fg;
      g.beginPath();
      g.moveTo(0, -2.2);
      g.quadraticCurveTo(9, -5.5, 16, -3.2);
      g.quadraticCurveTo(18.5, 0.5, 15, 4.2);
      g.quadraticCurveTo(8, 4.4, 0, 2.2);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.45)";
      g.lineWidth = 0.35;
      for (let k = -2; k <= 2; k++) {
        g.beginPath();
        g.moveTo(0.5, k * 0.6);
        g.lineTo(15.5, k * 1.6);
        g.stroke();
      }
      g.restore();
    });
  }

  function drawKoiPreview(g, view, paintLayer) {
    const look = customLook();
    buildKoiSprite(look, paintFromView(paintLayer), true);
    const fr = editorFrame(view.width, view.height);
    g.save();
    g.translate(fr.ox, fr.oy);
    g.scale(fr.s, fr.s);
    g.translate(-KOI.x0, KOI.hh);
    g.save();
    g.translate(4, 6);
    g.globalAlpha = 0.18;
    g.filter = "blur(" + fr.s * 2 + "px)";
    g.drawImage(look.sprite, KOI.x0, -KOI.hh, KOI.x1 - KOI.x0, KOI.hh * 2);
    g.restore();
    drawPectorals(g, look, 0);
    g.drawImage(look.sprite, KOI.x0, -KOI.hh, KOI.x1 - KOI.x0, KOI.hh * 2);
    g.restore();
  }

  function makeShadow(src, blur) {
    const s = document.createElement("canvas");
    s.width = src.naturalWidth || src.width;
    s.height = src.naturalHeight || src.height;
    const g = s.getContext("2d");
    g.filter = "blur(" + (blur || 3 * KOI.res) + "px)";
    g.drawImage(src, 0, 0);
    g.filter = "none";
    g.globalCompositeOperation = "source-in";
    g.fillStyle = "rgb(14,66,60)";
    g.fillRect(0, 0, s.width, s.height);
    return s;
  }

  function warpDraw(img, f, t) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const BW = KOI.x1 - KOI.x0;
    const BH = (BW * ih) / iw;
    const N = 16;
    const sw = BW / N;
    const ov = 0.3;
    const amp = f.boost > 0 ? 5.2 : 3.6;
    const ph = t * (5 + f.wag * 1.6) * (f.boost > 0 ? 1.5 : 1) + f.phase;
    const bend = (x) => {
      const u = clamp((30 - x) / (30 - KOI.x0), 0, 1);
      return amp * u * u * Math.sin(ph - u * 3.4);
    };
    for (let i = 0; i < N; i++) {
      const a = Math.max(KOI.x0, KOI.x0 + i * sw - ov);
      const b = Math.min(KOI.x1, KOI.x0 + (i + 1) * sw + ov);
      const xc = KOI.x0 + (i + 0.5) * sw;
      const slope = bend(xc + 0.5) - bend(xc - 0.5);
      ctx.save();
      ctx.translate(xc, bend(xc));
      ctx.rotate(Math.atan(slope));
      ctx.drawImage(img, ((a - KOI.x0) / BW) * iw, 0, ((b - a) / BW) * iw, ih, a - xc, -BH / 2, b - a, BH);
      ctx.restore();
    }
  }

  function spawn() {
    const rand = mulberry32(20240924);
    fishes.length = 0;
    turtles.length = 0;
    butterflies.length = 0;
    nextNum = 1;
    for (let i = 0; i < 36; i++) {
      const f = makeFish(rand);
      const p = placeInWater(rand);
      f.x = p.x;
      f.y = p.y;
      fishes.push(f);
    }
    const kinds = ["turtleSoftshell", "turtleBox", "turtleSpotted", "turtleMutica", Math.random() < 0.5 ? "turtle" : "turtleReeves"];
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    for (let i = 0; i < kinds.length; i++) {
      const p = placeInWater(rand);
      const art = kinds[i % kinds.length];
      turtles.push({
        kind: "turtle",
        art: art,
        x: p.x,
        y: p.y,
        a: rand() * Math.PI * 2,
        scale: critterArt[art].size * randRange(rand, 0.9, 1.1),
        speed: randRange(rand, 16, 26),
        phase: rand() * 6,
        wander: 0,
      });
    }
    const wingKinds = ["white", "swallow", "admiral", "morpho", "fritillary", "ringlet"];
    for (let i = 0; i < wingKinds.length; i++) {
      butterflies.push({
        x: rand() * W,
        y: H * (0.1 + rand() * 0.72),
        a: rand() * Math.PI * 2,
        scale: randRange(rand, 0.41, 0.59),
        speed: randRange(rand, 26, 46),
        phase: rand() * 8,
        flap: randRange(rand, 8, 13),
        kind: wingKinds[i],
      });
    }
    motes = Array.from({ length: 18 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.6 + 0.4,
      p: Math.random() * 6,
    }));
    bubbles = Array.from({ length: 70 }, () => {
      const b = {};
      resetBubble(b, true);
      return b;
    });
    fog = Array.from({ length: 4 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 160 + Math.random() * 140,
      s: 8 + Math.random() * 10,
    }));
  }

  function cleanName(name) {
    return String(name || "").replace(/[<>]/g, "").trim().slice(0, 14);
  }

  function addCustom(def, save) {
    const name = cleanName(def.name) || NAMES[Math.floor(Math.random() * NAMES.length)];
    let num = Number(def.num) || 0;
    if (!num || fishes.some((f) => f.num === num)) num = nextNum++;
    else if (num >= nextNum) nextNum = num + 1;
    if (!def.src || String(def.src).indexOf("data:image/") !== 0) return null;
    const img = new Image();
    const born = placeInWater(Math.random);
    const fish = Object.assign(customLook(), {
      id: "c" + num,
      num,
      name,
      custom: true,
      src: def.src,
      v: 2,
      scale: clamp(Number(def.scale) || 1, 0.4, 2.2),
      x: born.x,
      y: born.y,
      a: Math.random() * Math.PI * 2,
      baseSpeed: 58 / Math.pow(clamp(Number(def.scale) || 1, 0.4, 2.2), 0.35),
      phase: Math.random() * 6,
      wag: 0.4,
      wander: 0,
      group: Math.floor(Math.random() * 3),
      eaten: 0,
      flash: 0,
      boost: 0,
    });
    img.onload = function () {
      if (def.v === 2) {
        buildKoiSprite(fish, img);
        if (onRoster) onRoster();
        return;
      }
      const paint = legacyPaint(img);
      buildKoiSprite(fish, paint);
      fish.src = paint.toDataURL("image/png");
      persistCustoms();
      if (onRoster) onRoster();
    };
    img.src = def.src;
    fishes.push(fish);
    if (save) persistCustoms();
    if (onRoster) onRoster();
    return fish;
  }

  function persistCustoms() {
    const data = fishes.filter((f) => f.custom).map((f) => ({
      num: f.num,
      name: f.name,
      scale: f.scale,
      src: f.src,
      v: 2,
    }));
    try { localStorage.setItem("bitan.customs", JSON.stringify(data)); } catch (err) { /* 画得太大时可能写不下 */ }
  }

  function loadCustoms() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem("bitan.customs") || "[]"); } catch (err) { saved = []; }
    if (!Array.isArray(saved)) return;
    saved.forEach((item) => addCustom(item, false));
  }

  function removeCustom(num) {
    const idx = fishes.findIndex((f) => f.custom && f.num === num);
    if (idx < 0) return;
    fishes.splice(idx, 1);
    persistCustoms();
    if (onRoster) onRoster();
  }

  function weatherMul() {
    return { clear: 1, wind: 1.08, rain: 0.84, drizzle: 0.9, snow: 0.7, fog: 0.82 }[state.effect] || 1;
  }

  function windPush() {
    if (state.effect === "wind") return 42;
    if (state.effect === "rain") return 22;
    if (state.effect === "drizzle") return 12;
    if (state.wind > 28 && state.effect === "clear") return 16;
    return 0;
  }

  function steerFish(f, dt) {
    let tx = Math.cos(f.a);
    let ty = Math.sin(f.a);
    f.wander += (Math.random() - 0.5) * 0.8;
    f.wander *= 0.9;
    tx += Math.cos(f.a + Math.PI / 2) * f.wander * 0.7;
    ty += Math.sin(f.a + Math.PI / 2) * f.wander * 0.7;

    let n = 0;
    let sepX = 0, sepY = 0, aliX = 0, aliY = 0, cohX = 0, cohY = 0;
    for (let i = 0; i < fishes.length; i++) {
      const o = fishes[i];
      if (o === f || o.group !== f.group) continue;
      const dx = o.x - f.x;
      const dy = o.y - f.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 150 * 150 || d2 < 1) continue;
      const d = Math.sqrt(d2);
      n++;
      sepX -= dx / (d * d);
      sepY -= dy / (d * d);
      aliX += Math.cos(o.a);
      aliY += Math.sin(o.a);
      cohX += o.x;
      cohY += o.y;
    }
    if (n) {
      tx += sepX * 22 + (aliX / n) * 0.55 + ((cohX / n - f.x) * 0.003);
      ty += sepY * 22 + (aliY / n) * 0.55 + ((cohY / n - f.y) * 0.003);
    }
    const g = groups[f.group];
    const gdx = g.x - f.x;
    const gdy = g.y - f.y;
    const gd = Math.hypot(gdx, gdy) || 1;
    if (gd > 340) { tx += (gdx / gd) * 0.65; ty += (gdy / gd) * 0.65; }

    const mdx = f.x - mouse.x;
    const mdy = f.y - mouse.y;
    const md = Math.hypot(mdx, mdy);
    const mouseHot = mouse.inside && performance.now() - mouse.movedAt < 320;
    let fleeing = false;
    if (mouseHot && md < 110) {
      const s = (110 - md) / 110;
      tx += (mdx / (md || 1)) * 3.4 * s;
      ty += (mdy / (md || 1)) * 3.4 * s;
      f.boost = 0.8;
      fleeing = true;
    }
    for (let i = 0; i < scares.length; i++) {
      const sx = f.x - scares[i].x;
      const sy = f.y - scares[i].y;
      const sd = Math.hypot(sx, sy);
      if (sd > 130) continue;
      const s = (130 - sd) / 130;
      tx += (sx / (sd || 1)) * 3.6 * s;
      ty += (sy / (sd || 1)) * 3.6 * s;
      f.boost = 0.8;
      fleeing = true;
    }

    if (!fleeing) {
      let best = null;
      let bestD = 560;
      for (let i = 0; i < pellets.length; i++) {
        const p = pellets[i];
        if (p.dead) continue;
        const d = Math.hypot(p.x - f.x, p.y - f.y);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) {
        const dist = Math.max(bestD, 0.001);
        tx += ((best.x - f.x) / dist) * 2.5;
        ty += ((best.y - f.y) / dist) * 2.5;
        if (bestD < 18 + f.scale * 10) eat(f, best);
      }
    }

    const c = waterCenter();
    if (!inWater(f.x, f.y)) {
      tx += (c.x - f.x) * 0.02;
      ty += (c.y - f.y) * 0.02;
    }
    const ep = edgePush(f);
    tx += ep.x * 2.2;
    ty += ep.y * 2.2;

    const desired = Math.atan2(ty, tx);
    let diff = desired - f.a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = 2.4 * dt;
    f.a += clamp(diff, -maxTurn, maxTurn);
    const speed = (f.baseSpeed + (f.boost > 0 ? 46 : 0)) * weatherMul();
    const step = speed * dt;
    const nx = f.x + Math.cos(f.a) * step + windPush() * dt * 0.35;
    const ny = f.y + Math.sin(f.a) * step;
    moveInWater(f, nx, ny);
    if (inWater(f.x, f.y)) {
      f.wake = (f.wake || 0) + step;
      if (f.wake > 18) {
        f.wake = 0;
        pushWake(f.x - Math.cos(f.a) * 5, f.y - Math.sin(f.a) * 3, f.a, 0.42);
      }
    }
    f.boost = Math.max(0, f.boost - dt);
    f.flash = Math.max(0, f.flash - dt * 1.5);
  }

  function eat(fish, pellet) {
    if (pellet.dead) return;
    pellet.dead = true;
    fish.eaten += 1;
    fish.flash = 1;
    ripples.push({ x: pellet.x, y: pellet.y, r: 4, a: 0.55 });
    floats.push({ x: fish.x, y: fish.y - 16, text: fish.name, age: 0 });
    if (floats.length > 8) floats.shift();
    if (onEat) onEat(fish);
  }

  function pickGroupTarget(g) {
    const b = pondBounds();
    let best = null;
    let bestD = -1;
    for (let i = 0; i < 16; i++) {
      const x = b.x0 + Math.random() * (b.x1 - b.x0);
      const y = b.y0 + Math.random() * (b.y1 - b.y0);
      if (!inWater(x, y)) continue;
      let near = 1e9;
      for (let k = 0; k < groups.length; k++) {
        if (groups[k] === g) continue;
        near = Math.min(near, Math.hypot(groups[k].tx - x, groups[k].ty - y));
      }
      if (near > bestD) { bestD = near; best = { x: x, y: y }; }
    }
    if (!best) best = waterCenter();
    g.tx = best.x;
    g.ty = best.y;
  }

  function updateGroups(dt) {
    groups.forEach((g) => {
      let dx = g.tx - g.x;
      let dy = g.ty - g.y;
      if (Math.hypot(dx, dy) < 56) pickGroupTarget(g);
      dx = g.tx - g.x;
      dy = g.ty - g.y;
      const d = Math.hypot(dx, dy) || 1;
      const step = Math.min(d, 46 * dt);
      g.x += (dx / d) * step;
      g.y += (dy / d) * step;
    });
  }

  function updateTurtles(dt) {
    turtles.forEach((tur) => {
      tur.wander += (Math.random() - 0.5) * 0.4;
      tur.wander *= 0.92;
      let tx = Math.cos(tur.a) + Math.cos(tur.a + Math.PI / 2) * tur.wander;
      let ty = Math.sin(tur.a) + Math.sin(tur.a + Math.PI / 2) * tur.wander;
      const mdx = tur.x - mouse.x;
      const mdy = tur.y - mouse.y;
      const md = Math.hypot(mdx, mdy);
      if (mouse.inside && md < 90) {
        tx += mdx / md;
        ty += mdy / md;
      }
      const c = waterCenter();
      if (!inWater(tur.x, tur.y)) {
        tx += (c.x - tur.x) * 0.01;
        ty += (c.y - tur.y) * 0.01;
      }
      const ep = edgePush(tur);
      tx += ep.x * 1.6;
      ty += ep.y * 1.6;
      let diff = Math.atan2(ty, tx) - tur.a;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      tur.a += clamp(diff, -1.1 * dt, 1.1 * dt);
      const pace = tur.speed * weatherMul();
      tur.stroke = ((tur.stroke || tur.phase) + dt * (1.4 + pace * 0.12)) % (Math.PI * 2);
      const surge = pace * (0.85 + 0.3 * Math.abs(Math.sin(tur.stroke)));
      const nx = tur.x + Math.cos(tur.a) * surge * dt;
      const ny = tur.y + Math.sin(tur.a) * surge * dt;
      moveInWater(tur, nx, ny);
      tur.wake = (tur.wake || 0) + tur.speed * dt;
      if (tur.wake > 28) {
        tur.wake = 0;
        pushWake(tur.x, tur.y, tur.a, 0.32);
      }
    });
  }

  function updateButterflies(dt, t) {
    const alive = state.effect === "snow" ? 0.35 : state.effect === "rain" ? 0.6 : 1;
    butterflies.forEach((b) => {
      b.a += Math.sin(t * 0.45 + b.phase) * 0.55 * dt;
      const lift = Math.cos(t * b.flap + b.phase);
      b.x += Math.cos(b.a) * b.speed * alive * dt + windPush() * dt;
      b.y += Math.sin(b.a) * b.speed * 0.22 * alive * dt + lift * 10 * dt;
      if (b.x < -30) b.x = W + 20;
      if (b.x > W + 30) b.x = -20;
      if (b.y < H * 0.06) b.y = H * 0.06;
      if (b.y > H * 0.9) b.y = H * 0.9;
    });
  }

  function respawnDrop(d, first) {
    d.z = 0.3 + Math.random() * 1.1;
    d.land = Math.random() * H * 1.04;
    d.x = Math.random() * (W + 160) - 80;
    d.y = d.land - (first ? Math.random() : 1) * (140 + Math.random() * 260) * d.z;
  }

  function respawnFlake(d, first) {
    d.z = 0.3 + Math.random() * 1.15;
    d.land = Math.random() * H * 1.04;
    d.x = Math.random() * (W + 120) - 60;
    d.y = d.land - (first ? Math.random() : 1) * (160 + Math.random() * 420) * d.z;
    d.p = Math.random() * Math.PI * 2;
    d.f = 0.6 + Math.random() * 1.1;
    d.r = 0.9 + d.z * d.z * 2.6 + Math.random() * 0.7;
    d.spin = Math.random() * Math.PI;
  }

  function rainImpact(x, y, z) {
    if (x < 0 || y < 0 || x > W || y > H) return;
    const onLeaf = coverAt(x, y);
    if (!onLeaf && inWater(x, y)) {
      if (rings.length < 900) {
        rings.push({ x: x, y: y, r: 0.4, max: 5 + z * 11, a: 0.42 + z * 0.32, w: 0.7 + z * 0.6, wait: 0 });
        if (z > 0.7 && Math.random() < 0.55) rings.push({ x: x, y: y, r: 0.2, max: 3 + z * 6, a: 0.3 + z * 0.25, w: 0.6, wait: 0.14 });
      }
      if (z > 0.95 && Math.random() < 0.4) addRainBits(x, y, 2 + ((Math.random() * 3) | 0), 0.7);
    } else if (onLeaf) {
      if (Math.random() < 0.55) addRainBits(x, y, 2 + ((Math.random() * 4) | 0), 1);
      const li = leafAt(x, y);
      if (li >= 0 && leafPieces[li]) leafPieces[li].bob = Math.min(1, leafPieces[li].bob + 0.25 * z);
    }
  }

  function addRainBits(x, y, n, power) {
    if (rainBits.length > 260) return;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (14 + Math.random() * 30) * power;
      rainBits.push({ x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.8, z: 0, vz: (40 + Math.random() * 60) * power, r: 0.5 + Math.random() * 0.8 });
    }
  }

  function snowBlob(x, y, r, a) {
    if (!snowAcc) return;
    const g = snowAcc.getContext("2d");
    g.globalAlpha = a;
    g.drawImage(flakeSprite, x / 2 - r, y / 2 - r, r * 2, r * 2);
  }

  function landFlake(d) {
    const x = d.x;
    const y = d.land;
    if (x < 0 || y < 0 || x > W || y > H) return;
    if (coverAt(x, y)) {
      snowBlob(x, y, 1.2 + d.r * 0.9, 0.35);
    } else if (inWater(x, y) && rings.length < 520) {
      rings.push({ x: x, y: y, r: 0.3, max: 1.5 + d.z * 2.5, a: 0.12, w: 0.5, wait: 0 });
    }
  }

  function buildSnowField() {
    const { m, w: mw, h: mh } = cover;
    const d = new Float32Array(m.length);
    for (let i = 0; i < m.length; i++) d[i] = m[i] ? 1e6 : 0;
    const at = (x, y) => (x < 0 || y < 0 || x >= mw || y >= mh ? 0 : d[y * mw + x]);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = y * mw + x;
        if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
      }
    }
    for (let y = mh - 1; y >= 0; y--) {
      for (let x = mw - 1; x >= 0; x--) {
        const i = y * mw + x;
        if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
      }
    }
    const grid = (cell) => {
      const gw = Math.ceil(mw / cell) + 2;
      const gh = Math.ceil(mh / cell) + 2;
      const v = new Float32Array(gw * gh).map(() => Math.random());
      return (x, y) => {
        const fx = x / cell;
        const fy = y / cell;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = v[iy * gw + ix] + (v[iy * gw + ix + 1] - v[iy * gw + ix]) * sx;
        const b = v[(iy + 1) * gw + ix] + (v[(iy + 1) * gw + ix + 1] - v[(iy + 1) * gw + ix]) * sx;
        return a + (b - a) * sy;
      };
    };
    const n1 = grid(14);
    const n2 = grid(5);
    const field = new Float32Array(m.length);
    const tone = new Float32Array(m.length);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = y * mw + x;
        if (!m[i]) { field[i] = -1; continue; }
        const nz = n1(x, y) * 0.65 + n2(x, y) * 0.35;
        const depth = clamp(d[i] / 7, 0, 1);
        field[i] = depth * 0.5 + nz * 0.5;
        if (cover.pink && cover.pink[i]) field[i] = field[i] * 0.55 - 0.1;
        tone[i] = clamp(d[i] / 3.5, 0, 1) * 0.6 + n2(x, y) * 0.4;
      }
    }
    snowField = { field: field, tone: tone, w: mw, h: mh, canvas: makeCanvas(mw, mh) };
    snowField.img = snowField.canvas.getContext("2d").createImageData(mw, mh);
  }

  function paintSnowField() {
    const sf = snowField;
    const t = 1.02 - snowLevel * 1.08;
    const px = sf.img.data;
    for (let i = 0; i < sf.field.length; i++) {
      const f = sf.field[i];
      if (f < 0) { px[i * 4 + 3] = 0; continue; }
      const u = clamp((f - t + 0.1) / 0.2, 0, 1);
      const a = u * u * (3 - 2 * u);
      const k = sf.tone[i];
      px[i * 4] = 188 + 66 * k;
      px[i * 4 + 1] = 206 + 49 * k;
      px[i * 4 + 2] = 222 + 33 * k;
      px[i * 4 + 3] = a * (200 + 30 * k);
    }
    sf.canvas.getContext("2d").putImageData(sf.img, 0, 0);
  }

  function updateSnowCover(dt) {
    if (!snowAcc || !cover) return;
    const snowing = state.effect === "snow";
    if (snowing && snowLevel < 1) snowLevel = Math.min(1, snowLevel + dt / 45);
    snowTick -= dt;
    if (snowTick > 0) return;
    snowTick = 0.3;
    if (!snowing && snowLevel === 0) return;
    if (!snowField) buildSnowField();
    if (snowLevel > 0) paintSnowField();
    const ag = snowAcc.getContext("2d");
    const w = snowAcc.width;
    const h = snowAcc.height;
    if (!snowing && snowLevel > 0) {
      snowLevel = Math.max(0, snowLevel - 0.3 / 24);
      ag.globalAlpha = 0.045;
      ag.globalCompositeOperation = "destination-out";
      ag.fillRect(0, 0, w, h);
      if (snowLevel === 0) ag.clearRect(0, 0, w, h);
    }
    ag.globalAlpha = 1;
    ag.globalCompositeOperation = "destination-in";
    ag.drawImage(cover.canvas, 0, 0, w, h);
    ag.globalCompositeOperation = "source-over";
    const sg = snowShade.getContext("2d");
    sg.clearRect(0, 0, w, h);
    sg.globalCompositeOperation = "source-over";
    sg.drawImage(snowAcc, 0, 0);
    sg.globalCompositeOperation = "source-in";
    sg.fillStyle = "rgb(118,150,170)";
    sg.fillRect(0, 0, w, h);
    const dg = snowDraw.getContext("2d");
    dg.clearRect(0, 0, w, h);
    dg.globalCompositeOperation = "source-over";
    dg.globalAlpha = 1;
    dg.imageSmoothingEnabled = true;
    dg.drawImage(snowField.canvas, 0, 0, w, h);
    dg.globalAlpha = 0.55;
    dg.drawImage(snowShade, 0.8, 1.1);
    dg.globalAlpha = 1;
    dg.drawImage(snowAcc, 0, 0);
    dg.globalCompositeOperation = "destination-in";
    dg.drawImage(cover.canvas, 0, 0, w, h);
    dg.globalCompositeOperation = "source-over";
  }

  function buildWeatherArt() {
    flakeSprite = makeCanvas(32, 32);
    const fg = flakeSprite.getContext("2d");
    const grad = fg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(250,253,255,0.85)");
    grad.addColorStop(1, "rgba(240,248,255,0)");
    fg.fillStyle = grad;
    fg.fillRect(0, 0, 32, 32);
    flakeShadow = makeCanvas(32, 32);
    const sg = flakeShadow.getContext("2d");
    sg.drawImage(flakeSprite, 0, 0);
    sg.globalCompositeOperation = "source-in";
    sg.fillStyle = "rgb(40,70,86)";
    sg.fillRect(0, 0, 32, 32);
    rainTex = makeCanvas(256, 256);
    const rg = rainTex.getContext("2d");
    rg.strokeStyle = "rgba(225,240,245,1)";
    rg.lineCap = "round";
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const len = 8 + Math.random() * 18;
      rg.globalAlpha = 0.08 + Math.random() * 0.14;
      rg.lineWidth = 0.5 + Math.random() * 0.5;
      for (let ox = -256; ox <= 256; ox += 256) {
        for (let oy = -256; oy <= 256; oy += 256) {
          rg.beginPath();
          rg.moveTo(x + ox, y + oy);
          rg.lineTo(x + ox - len * 0.08, y + oy - len);
          rg.stroke();
        }
      }
    }
  }

  function syncWeatherBits() {
    const wantDrops = state.effect === "rain" ? 720 : state.effect === "drizzle" ? 120 : 0;
    while (drops.length < wantDrops) { const d = {}; respawnDrop(d, true); drops.push(d); }
    if (drops.length > wantDrops) drops.length = wantDrops;
    const wantFlakes = state.effect === "snow" ? 520 : 0;
    while (flakes.length < wantFlakes) { const d = {}; respawnFlake(d, true); flakes.push(d); }
    if (flakes.length > wantFlakes) flakes.length = wantFlakes;
    const wantLeaves = state.effect === "wind" ? 26 : 0;
    while (leaves.length < wantLeaves) {
      leaves.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 3, s: 0.6 + Math.random(), petal: Math.random() < 0.45, p: Math.random() * 6 });
    }
    if (leaves.length > wantLeaves) leaves.length = wantLeaves;
  }

  function updateWeather(dt, t) {
    syncWeatherBits();
    const push = windPush();
    drops.forEach((d) => {
      d.y += (760 + d.z * 860) * dt;
      d.x += push * (0.8 + d.z) * 1.6 * dt;
      if (d.y >= d.land) {
        rainImpact(d.x, d.land, d.z);
        respawnDrop(d, false);
      }
    });
    rings.forEach((r) => {
      if (r.wait > 0) { r.wait -= dt; return; }
      r.r += dt * r.max * 2.6;
    });
    rings = rings.filter((r) => r.r < r.max);
    rainBits.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= 300 * dt;
    });
    rainBits = rainBits.filter((p) => p.z > 0);
    if (state.effect === "rain") {
      flashIn -= dt;
      if (flashIn <= 0) {
        flash = 1;
        flashIn = 12 + Math.random() * 22;
      }
    }
    flash = Math.max(0, flash - dt * 2.2);
    flakes.forEach((d) => {
      d.y += (12 + d.z * 36) * dt;
      d.x += Math.sin(t * d.f + d.p) * (5 + d.z * 13) * dt + push * 0.35 * (0.4 + d.z) * dt;
      d.spin += dt * (0.4 + d.f * 0.6);
      if (d.y >= d.land) {
        landFlake(d);
        respawnFlake(d, false);
      }
    });
    updateSnowCover(dt);
    leaves.forEach((d) => {
      d.x += (90 + d.s * 120) * dt;
      d.y += Math.sin(t * 2 + d.p + d.x * 0.01) * 34 * dt;
      d.r += dt * (2 + d.s * 2);
      if (d.x > W + 14) { d.x = -14; d.y = Math.random() * H; }
    });
    motes.forEach((m) => {
      m.y -= 8 * dt;
      m.x += Math.sin(t + m.p) * 6 * dt;
      if (m.y < 0) { m.y = H; m.x = Math.random() * W; }
    });
    bubbles.forEach((b) => {
      b.life += dt;
      b.x += Math.sin(t * 1.3 + b.p) * 4 * dt;
      b.y -= b.vy * dt;
      if (b.life > b.max) resetBubble(b, false);
    });
  }

  function resetBubble(b, initial) {
    const cx = Math.random() * W;
    const cy = Math.random() * H;
    b.x = cx;
    b.y = cy;
    b.r = Math.random() < 0.15 ? 4 + Math.random() * 5 : 1.2 + Math.random() * 3;
    b.vy = 2 + Math.random() * 6;
    b.p = Math.random() * 6;
    b.max = 6 + Math.random() * 10;
    b.life = initial ? Math.random() * b.max : 0;
  }

  function drawBubbles() {
    bubbles.forEach((b) => {
      const fade = Math.min(1, b.life / 1.2, (b.max - b.life) / 1.5);
      if (fade <= 0 || coverAt(b.x, b.y)) return;
      ctx.save();
      ctx.globalAlpha = 0.85 * fade;
      const grd = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
      grd.addColorStop(0, "rgba(255,255,255,0.9)");
      grd.addColorStop(0.45, "rgba(220,255,250,0.18)");
      grd.addColorStop(0.85, "rgba(200,250,245,0.28)");
      grd.addColorStop(1, "rgba(255,255,255,0.65)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function feed(x, y) {
    if (!inWater(x, y) || coverAt(x, y)) return;
    for (let i = 0; i < 5; i++) {
      const px = x + (Math.random() - 0.5) * 36;
      const py = y + (Math.random() - 0.5) * 24;
      if (!inWater(px, py) || coverAt(px, py)) continue;
      pellets.push({
        x: px,
        y: py,
        r: 3 + Math.random() * 2.2,
        age: 0,
        life: 15 + Math.random() * 6,
        dead: false,
      });
    }
    if (pellets.length > 48) pellets.splice(0, pellets.length - 48);
    ripples.push({ x, y, r: 6, a: 0.4 });
  }

  function paintKoiLocal(f, t) {
    ctx.scale(f.scale * VIEW, f.scale * VIEW);
    if (!f.sprite) return;
    drawPectorals(ctx, f, Math.sin(t * 2.6 + f.phase * 1.3) * 0.3);
    warpDraw(f.sprite, f, t);
    if (f.flash > 0) {
      ctx.strokeStyle = "rgba(255,255,255," + f.flash.toFixed(3) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(6, 0, 46, 16, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawFloorShadow(f) {
    if (f.kind === "turtle") {
      const art = critterArt[f.art] || critterArt.turtle;
      drawCritterShadow(art, f.x + 16 * VIEW, f.y + 24 * VIEW, f.a, (VIEW * TURTLE_LEN * f.scale) / art.meta.unit, 0.32);
      return;
    }
    ctx.save();
    ctx.translate(f.x + 16 * VIEW, f.y + 24 * VIEW);
    ctx.rotate(f.a);
    ctx.scale(f.scale * VIEW, f.scale * VIEW);
    if (f.shadow || f.image) {
      ctx.globalAlpha = f.shadow ? 0.34 : 0.22;
      if (f.shadow) ctx.drawImage(f.shadow, KOI.x0, -KOI.hh, KOI.x1 - KOI.x0, KOI.hh * 2);
      else {
        ctx.fillStyle = "rgb(14,66,60)";
        ctx.beginPath();
        ctx.ellipse(0, 0, 50, 13, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    const sh = ctx.createRadialGradient(8, 0, 4, 8, 0, 34);
    sh.addColorStop(0, "rgba(14, 66, 60, 0.34)");
    sh.addColorStop(1, "rgba(14, 66, 60, 0)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(8, 0, 34, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawKoi(f, t) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.a);
    paintKoiLocal(f, t);
    ctx.restore();
  }

  function drawKoiReflection(f, t) {
    ctx.save();
    ctx.translate(f.x - 2, f.y + 4);
    ctx.rotate(-f.a);
    ctx.scale(1, -0.38);
    ctx.globalAlpha = 0.2;
    paintKoiLocal(f, t);
    ctx.restore();
  }

  function drawTurtle(tur, t) {
    const art = critterArt[tur.art] || critterArt.turtle;
    if (!art.ready) return;
    const m = art.meta;
    const u = VIEW * TURTLE_LEN * tur.scale / m.unit;
    const phi = tur.stroke || 0;
    ctx.save();
    ctx.translate(tur.x, tur.y);
    ctx.rotate(tur.a + Math.sin(t * 1.2 + tur.phase) * 0.03 + Math.sin(phi) * 0.035);
    ctx.scale(u * (art.sx || 1), u * (art.sy || 1));
    ctx.translate(-m.ax, -m.ay);
    art.legs.forEach((leg) => {
      const p = phi + (leg.diag ? 0 : Math.PI);
      const reach = Math.cos(p);
      const recovering = Math.sin(p) < 0;
      const amp = leg.front ? 0.62 : 0.4;
      const fold = recovering ? 1 - 0.22 * -Math.sin(p) : 1;
      ctx.save();
      ctx.translate(leg.px, leg.py);
      ctx.rotate(-leg.side * amp * reach);
      ctx.scale(fold, fold);
      ctx.translate(-leg.px, -leg.py);
      drawMip(leg.mips, u, 0, 0);
      ctx.restore();
    });
    drawMip(art.bodyMips, u, 0, 0);
    ctx.save();
    ctx.translate(art.neck.x, art.neck.y);
    ctx.rotate(Math.sin(t * 0.9 + tur.phase * 2) * 0.1);
    ctx.translate(-art.neck.x, -art.neck.y);
    ctx.translate(Math.sin(phi * 2) * 0.012 * m.unit, 0);
    drawMip(art.headMips, u, 0, 0);
    ctx.restore();
    ctx.restore();
  }

  function drawCritterShadow(art, x, y, a, u, alpha) {
    if (!art.ready) return;
    const m = art.meta;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(u, u);
    ctx.globalAlpha = alpha;
    ctx.drawImage(art.shadow, -m.ax, -m.ay);
    ctx.restore();
  }

  const critterArt = {
    frogSit: { meta: { w: 200, h: 170, ax: 99.53, ay: 82.15, unit: 42.65 }, src: "frog-sit.png" },
    frogLeap: { meta: { w: 200, h: 141, ax: 143.35, ay: 64.56, unit: 23.72 }, src: "frog-leap.png" },
    turtle: { meta: { w: 360, h: 225, ax: 160.15, ay: 102.21, unit: 228.14 }, src: "turtle.png", turtle: true, size: 1, tone: "brightness(1.66) saturate(0.95) contrast(0.84)" },
    turtleMutica: { meta: { w: 360, h: 226, ax: 159.95, ay: 102.08, unit: 227.85 }, src: "turtle-mutica.png", turtle: true, size: 0.88, tone: "brightness(1.36) saturate(1.05) contrast(0.86)" },
    turtleSoftshell: { meta: { w: 360, h: 222, ax: 155.48, ay: 99.83, unit: 220.86 }, src: "turtle-softshell.png", turtle: true, size: 1.15, sx: 1, sy: 1.1, tone: "brightness(1.42) saturate(0.95) contrast(0.86)" },
    turtleBox: { meta: { w: 360, h: 226, ax: 159.55, ay: 101.82, unit: 227.27 }, src: "turtle-box.png", turtle: true, size: 0.82, sx: 0.92, sy: 1.08, tone: "brightness(1.5) saturate(0.95) contrast(0.86)" },
    turtleSpotted: { meta: { w: 360, h: 226, ax: 159.7, ay: 102.21, unit: 228.14 }, src: "turtle-spotted.png", turtle: true, size: 1.05, sx: 1.07, sy: 0.92, tone: "brightness(1.68) contrast(0.8)" },
    turtleReeves: { meta: { w: 360, h: 225, ax: 159.95, ay: 102.08, unit: 227.85 }, src: "turtle-reeves.png", turtle: true, size: 0.92, tone: "brightness(1.55) saturate(0.95) contrast(0.84)" },
  };
  const TURTLE_KINDS = Object.keys(critterArt).filter((k) => critterArt[k].turtle);

  function splitTurtle(art) {
    const img = art.img;
    const m = art.meta;
    const P = (ux, uy) => ({ x: m.ax + ux * m.unit, y: m.ay + uy * m.unit });
    const layer = (fn) => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d");
      g.filter = art.tone || "none";
      g.drawImage(img, 0, 0);
      g.filter = "none";
      fn(g);
      return c;
    };
    const shell = (g) => {
      const c = P(0.01, 0.015);
      const a = 0.535 * m.unit;
      const b = 0.415 * m.unit;
      g.beginPath();
      for (let i = 0; i < 96; i++) {
        const th = (i / 96) * Math.PI * 2;
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        const x = c.x + a * Math.sign(cs) * Math.abs(cs) ** (2 / 2.8);
        const y = c.y + b * Math.sign(sn) * Math.abs(sn) ** (2 / 2.8);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.closePath();
    };
    const tailBox = (g) => {
      const a = P(-0.85, -0.07);
      g.rect(a.x, a.y, 0.4 * m.unit, 0.14 * m.unit);
    };
    const headBox = (g) => {
      const a = P(0.44, -0.15);
      g.beginPath();
      g.rect(a.x, a.y, 0.6 * m.unit, 0.3 * m.unit);
    };
    art.head = layer((g) => {
      g.globalCompositeOperation = "destination-in";
      headBox(g);
      g.fill();
      g.globalCompositeOperation = "destination-out";
      shell(g);
      g.fill();
    });
    art.neck = P(0.46, 0);
    const quads = [
      { front: true, side: -1, diag: true, c: P(0.56, -0.33), attach: P(0.42, -0.24) },
      { front: true, side: 1, diag: false, c: P(0.56, 0.36), attach: P(0.42, 0.26) },
      { front: false, side: -1, diag: false, c: P(-0.45, -0.32), attach: P(-0.34, -0.25) },
      { front: false, side: 1, diag: true, c: P(-0.46, 0.38), attach: P(-0.34, 0.28) },
    ];
    art.legs = quads.map((q) => ({
      front: q.front,
      side: q.side,
      diag: q.diag,
      px: q.attach.x,
      py: q.attach.y,
      canvas: layer((g) => {
        g.globalCompositeOperation = "destination-in";
        g.beginPath();
        g.arc(q.c.x, q.c.y, 0.25 * m.unit, 0, Math.PI * 2);
        g.fill();
        g.globalCompositeOperation = "destination-out";
        shell(g);
        tailBox(g);
        g.fill();
        headBox(g);
        g.fill();
      }),
    }));
    art.body = layer((g) => {
      g.globalCompositeOperation = "destination-in";
      shell(g);
      tailBox(g);
      g.fill();
    });
  }

  function mipChain(src) {
    const list = [src];
    let c = src;
    while (c.width > 24) {
      const n = document.createElement("canvas");
      n.width = Math.round(c.width / 2);
      n.height = Math.max(1, Math.round(c.height / 2));
      const g = n.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(c, 0, 0, n.width, n.height);
      list.push(n);
      c = n;
    }
    return list;
  }

  function drawMip(list, k, x, y) {
    const w = list[0].naturalWidth || list[0].width;
    const h = list[0].naturalHeight || list[0].height;
    const px = Math.abs(k) * dpr;
    let l = 0;
    while (l + 1 < list.length && px * 2 ** (l + 1) <= 1.15) l++;
    ctx.drawImage(list[l], x, y, w, h);
  }

  Object.keys(critterArt).forEach((key) => {
    const art = critterArt[key];
    art.img = new Image();
    art.img.onload = () => {
      art.shadow = makeShadow(art.img, 5);
      art.mips = mipChain(art.img);
      if (art.turtle) {
        splitTurtle(art);
        art.bodyMips = mipChain(art.body);
        art.headMips = mipChain(art.head);
        art.legs.forEach((leg) => (leg.mips = mipChain(leg.canvas)));
      }
      art.ready = true;
    };
    art.img.src = art.src;
  });

  function butterflyWing(hind) {
    ctx.beginPath();
    if (!hind) {
      ctx.moveTo(0.4, -1);
      ctx.bezierCurveTo(3, -16, 18, -13, 17, -2);
      ctx.bezierCurveTo(16, 3, 8, 4, 0.6, 2);
    } else {
      ctx.moveTo(0.4, 1);
      ctx.bezierCurveTo(2, 3, 13, 5, 12, 12);
      ctx.bezierCurveTo(8, 15, 3, 9, 0.5, 4);
    }
    ctx.closePath();
  }

  function paintButterflyWing(kind, hind) {
    butterflyWing(hind);
    if (kind === "white") {
      ctx.fillStyle = hind ? "#f7f4ea" : "#fbf8f1";
      ctx.fill();
      if (!hind) {
        ctx.fillStyle = "#2a2a2a";
        ctx.beginPath();
        ctx.moveTo(14, -8);
        ctx.lineTo(17, -2);
        ctx.lineTo(11, -3);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(8, -1, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === "swallow") {
      ctx.fillStyle = hind ? "#e2b03a" : "#f0c84a";
      ctx.fill();
      ctx.strokeStyle = "#1c1c1c";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(1, hind ? 2 : -1);
      ctx.lineTo(hind ? 10 : 14, hind ? 10 : -8);
      ctx.moveTo(1, hind ? 2 : -1);
      ctx.lineTo(hind ? 7 : 9, hind ? 13 : -2);
      ctx.stroke();
      if (hind) {
        ctx.fillStyle = "#1c1c1c";
        ctx.beginPath();
        ctx.moveTo(10, 12);
        ctx.lineTo(13, 18);
        ctx.lineTo(8, 13);
        ctx.fill();
      }
    } else if (kind === "admiral") {
      ctx.fillStyle = "#2c2622";
      ctx.fill();
      ctx.fillStyle = "#d4543a";
      ctx.beginPath();
      if (!hind) {
        ctx.moveTo(2, -2);
        ctx.quadraticCurveTo(10, -8, 15, -3);
        ctx.quadraticCurveTo(9, -1, 2, 1);
      } else {
        ctx.moveTo(1, 3);
        ctx.quadraticCurveTo(8, 6, 11, 11);
        ctx.quadraticCurveTo(6, 8, 1, 5);
      }
      ctx.fill();
      if (!hind) {
        ctx.fillStyle = "#f4f0e6";
        ctx.fillRect(13, -7, 1.3, 1.3);
        ctx.fillRect(11.5, -5.5, 1.1, 1.1);
      }
    } else if (kind === "morpho") {
      ctx.fillStyle = hind ? "#245fad" : "#2f74c4";
      ctx.fill();
      ctx.fillStyle = "rgba(159,208,242,0.55)";
      ctx.beginPath();
      ctx.ellipse(hind ? 6 : 8, hind ? 8 : -6, hind ? 4 : 5, hind ? 3.2 : 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#162033";
      ctx.lineWidth = 1.1;
      butterflyWing(hind);
      ctx.stroke();
    } else if (kind === "fritillary") {
      ctx.fillStyle = hind ? "#d86b2e" : "#e4843a";
      ctx.fill();
      ctx.fillStyle = "#1c140e";
      const spots = hind ? [[4, 6], [8, 8], [7, 12]] : [[5, -8], [10, -6], [8, -2], [13, -4]];
      spots.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 0.85, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.strokeStyle = "#3a2418";
      ctx.lineWidth = 0.8;
      butterflyWing(hind);
      ctx.stroke();
    } else {
      ctx.fillStyle = hind ? "#5c4638" : "#6d5344";
      ctx.fill();
      if (!hind) {
        ctx.fillStyle = "#f3e4b4";
        ctx.beginPath();
        ctx.arc(11, -3, 2.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#2a2118";
        ctx.beginPath();
        ctx.arc(11, -3, 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.beginPath();
        ctx.arc(10.5, -3.4, 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "#3a2e24";
      ctx.lineWidth = 0.6;
      butterflyWing(hind);
      ctx.stroke();
    }
  }

  function drawButterfly(b, t) {
    const cycle = t * b.flap + b.phase;
    const spread = 0.18 + 0.82 * Math.pow(Math.abs(Math.sin(cycle)), 0.62);
    const dim = state.effect === "snow" ? 0.35 : state.effect === "rain" ? 0.7 : 1;
    const kind = b.kind || "white";
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a + Math.sin(cycle) * 0.08);
    ctx.scale(b.scale, b.scale);
    ctx.globalAlpha = dim;
    [-1, 1].forEach((side) => {
      ctx.save();
      ctx.scale(side, spread);
      paintButterflyWing(kind, false);
      paintButterflyWing(kind, true);
      ctx.restore();
    });
    ctx.fillStyle = "#241c16";
    ctx.beginPath();
    ctx.ellipse(0, 0.5, 1.15, 6.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -6.4, 1.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#241c16";
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(-0.4, -7.2);
    ctx.quadraticCurveTo(-3.5, -12, -2.2, -14);
    ctx.moveTo(0.4, -7.2);
    ctx.quadraticCurveTo(3.5, -12, 2.2, -14);
    ctx.stroke();
    ctx.restore();
  }

  function drawPellet(p) {
    const fade = clamp(1 - p.age / p.life, 0, 1);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#e3b56a";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r, p.r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.arc(p.x - 1, p.y - 1, p.r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function frogSize() { return VIEW * 14; }

  function seatBlocked(s) {
    const els = document.querySelectorAll(".journal, .brand");
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (!r.width) continue;
      if (s.x > r.left - 24 && s.x < r.right + 24 && s.y > r.top - 24 && s.y < r.bottom + 24) return true;
    }
    const pad = 2.2 * frogSize();
    if (s.x < pad || s.y < pad || s.x > W - pad || s.y > H - pad) return true;
    return s.r < 2.2 * frogSize();
  }

  function freeSeats(fr) {
    return seats.filter((s) => (!s.frog || s.frog === fr) && s !== fr.seat && !seatBlocked(s));
  }

  function takeSeat(fr, s) {
    if (fr.seat && fr.seat.frog === fr) fr.seat.frog = null;
    fr.seat = s;
    if (s) s.frog = fr;
  }

  function spawnFrogs() {
    frogs = [];
    const open = seats.filter((s) => !seatBlocked(s));
    const n = Math.min(4, Math.max(0, Math.floor(open.length / 3)));
    for (let i = 0; i < n; i++) {
      const fr = {
        x: 0,
        y: 0,
        a: Math.random() * Math.PI * 2,
        state: "lost",
        kind: "frog",
        seat: null,
        timer: 4 + Math.random() * 10,
        croak: 0,
        croakIn: 3 + Math.random() * 8,
        kick: 0,
        land: 0,
        size: 0.85 + Math.random() * 0.3,
        jump: null,
        swimFor: 0,
      };
      frogs.push(fr);
    }
  }

  function placeLostFrog(fr) {
    const open = seats.filter((s) => !s.frog && !seatBlocked(s));
    if (!open.length) return;
    const s = open[Math.floor(Math.random() * open.length)];
    takeSeat(fr, s);
    fr.x = s.x;
    fr.y = s.y;
    fr.state = "sit";
  }

  function waterSpotNear(x, y, away) {
    for (let k = 0; k < 30; k++) {
      const ang = away != null ? away + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2;
      const d = 70 + Math.random() * 110;
      const px = x + Math.cos(ang) * d;
      const py = y + Math.sin(ang) * d;
      const pad = frogSize() * 2.8;
      if (px < pad || py < pad || px > W - pad || py > H - pad) continue;
      if (inWater(px, py) && !coverAt(px, py)) return { x: px, y: py };
    }
    return null;
  }

  function startJump(fr, tx, ty, toSeat, height, dur) {
    fr.jump = { x0: fr.x, y0: fr.y, x1: tx, y1: ty, t: 0, dur: dur, h: height, seat: toSeat };
    fr.a = Math.atan2(ty - fr.y, tx - fr.x);
    fr.state = "jump";
    if (toSeat) takeSeat(fr, toSeat);
    else takeSeat(fr, null);
  }

  function frogLeap(fr, awayFrom) {
    const away = awayFrom ? Math.atan2(fr.y - awayFrom.y, fr.x - awayFrom.x) : null;
    const options = freeSeats(fr).filter((s) => {
      const d = Math.hypot(s.x - fr.x, s.y - fr.y);
      if (d < 50 || d > 380) return false;
      if (away == null) return true;
      return Math.cos(Math.atan2(s.y - fr.y, s.x - fr.x) - away) > 0.2;
    });
    const wantWater = !options.length || Math.random() < (awayFrom ? 0.45 : 0.3);
    if (!wantWater) {
      const s = options[Math.floor(Math.random() * options.length)];
      const d = Math.hypot(s.x - fr.x, s.y - fr.y);
      startJump(fr, s.x, s.y, s, 26 + d * 0.16, 0.45 + d / 900);
      return;
    }
    const spot = waterSpotNear(fr.x, fr.y, away);
    if (spot) startJump(fr, spot.x, spot.y, null, 30, 0.6);
    else if (options.length) frogLeap(fr, null);
  }

  function addSplash(x, y, power) {
    ripples.push({ x: x, y: y, r: 3, a: 0.6 * power, grow: 30, max: 46 });
    ripples.push({ x: x, y: y, r: 1, a: 0.45 * power, grow: 20, max: 34 });
    for (let i = 0; i < 12 * power; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 20 + Math.random() * 50;
      splashes.push({ x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.8, z: 0, vz: 60 + Math.random() * 90, r: 0.8 + Math.random() * 1.4 });
    }
    scares.push({ x: x, y: y, until: performance.now() + 900 });
  }

  function updateFrogs(dt) {
    const now = performance.now();
    scares = scares.filter((s) => s.until > now);
    splashes.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= 320 * dt;
    });
    splashes = splashes.filter((p) => p.z > 0);
    if (!frogs.length && seats.length) spawnFrogs();
    const mouseHot = mouse.inside && now - mouse.movedAt < 320;
    frogs.forEach((fr) => {
      if (fr.state === "lost") { placeLostFrog(fr); return; }
      fr.croak = Math.max(0, fr.croak - dt);
      fr.land = Math.max(0, fr.land - dt);
      if (fr.state === "sit") {
        fr.timer -= dt;
        fr.croakIn -= dt;
        if (fr.croakIn <= 0) {
          fr.croak = 0.9;
          fr.croakIn = 6 + Math.random() * 12;
          floats.push({ x: fr.x, y: fr.y - 2.6 * frogSize() * fr.size, text: "呱", age: 0 });
        }
        if (mouseHot && Math.hypot(mouse.x - fr.x, mouse.y - fr.y) < 60) {
          frogLeap(fr, mouse);
        } else if (fr.timer <= 0) {
          fr.timer = 7 + Math.random() * 14;
          frogLeap(fr, null);
        }
      } else if (fr.state === "jump") {
        const j = fr.jump;
        j.t = Math.min(1, j.t + dt / j.dur);
        const e = j.t < 0.5 ? 2 * j.t * j.t : 1 - Math.pow(-2 * j.t + 2, 2) / 2;
        fr.x = j.x0 + (j.x1 - j.x0) * e;
        fr.y = j.y0 + (j.y1 - j.y0) * e;
        if (j.t >= 1) {
          fr.jump = null;
          fr.land = 0.25;
          if (j.seat) {
            fr.state = "sit";
            fr.timer = 5 + Math.random() * 12;
          } else {
            fr.state = "swim";
            fr.swimFor = 2 + Math.random() * 3;
            fr.goal = null;
            addSplash(fr.x, fr.y, 1);
          }
        }
      } else if (fr.state === "swim") {
        fr.kick += dt * 2.6;
        fr.swimFor -= dt;
        if (!fr.goal && fr.swimFor <= 0) {
          const open = freeSeats(fr).sort((a, b) => Math.hypot(a.x - fr.x, a.y - fr.y) - Math.hypot(b.x - fr.x, b.y - fr.y));
          if (open.length) {
            const s = open[Math.floor(Math.random() * Math.min(3, open.length))];
            s.frog = fr;
            fr.goal = s;
          }
        }
        let tx;
        let ty;
        if (fr.goal) {
          const ang = Math.atan2(fr.y - fr.goal.y, fr.x - fr.goal.x);
          tx = fr.goal.x + Math.cos(ang) * (fr.goal.r + 10);
          ty = fr.goal.y + Math.sin(ang) * (fr.goal.r + 10);
          if (Math.hypot(tx - fr.x, ty - fr.y) < 10) {
            const s = fr.goal;
            fr.goal = null;
            addSplash(fr.x, fr.y, 0.5);
            startJump(fr, s.x, s.y, s, 16, 0.42);
            return;
          }
        } else {
          tx = fr.x + Math.cos(fr.a) * 40 + (Math.random() - 0.5) * 30;
          ty = fr.y + Math.sin(fr.a) * 40 + (Math.random() - 0.5) * 30;
        }
        const want = Math.atan2(ty - fr.y, tx - fr.x);
        let diff = want - fr.a;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        fr.a += clamp(diff, -2 * dt, 2 * dt);
        const pulse = 0.35 + 0.9 * Math.max(0, Math.sin(fr.kick * Math.PI * 2));
        const step = 34 * pulse * dt;
        const nx = fr.x + Math.cos(fr.a) * step;
        const ny = fr.y + Math.sin(fr.a) * step;
        const ep = edgePush(fr);
        if (ep.x || ep.y) fr.a += clamp(Math.sin(Math.atan2(ep.y, ep.x) - fr.a), -1, 1) * 2.5 * dt;
        if (roomFor(nx, ny, bodyPad(fr))) { fr.x = nx; fr.y = ny; }
        else fr.a += Math.PI * 0.5;
        fr.wake = (fr.wake || 0) + step;
        if (fr.wake > 16) {
          fr.wake = 0;
          pushWake(fr.x, fr.y, fr.a, 0.36);
        }
      }
    });
  }

  function frogHit(x, y) {
    let best = null;
    let bestD = Math.max(14, 3 * frogSize());
    frogs.forEach((fr) => {
      if (fr.state !== "sit" && fr.state !== "swim") return;
      const d = Math.hypot(fr.x - x, fr.y - y);
      if (d < bestD) { bestD = d; best = fr; }
    });
    return best;
  }

  function drawFrog(fr, t, under) {
    if (under !== (fr.state === "swim")) return;
    const sit = critterArt.frogSit;
    const leap = critterArt.frogLeap;
    if (!sit.ready || !leap.ready) return;
    const unit = frogSize() * fr.size;
    let lift = 0;
    let stretch = 0;
    if (fr.state === "jump") {
      lift = Math.sin(Math.PI * fr.jump.t);
      stretch = clamp(Math.sin(Math.PI * Math.min(1, fr.jump.t * 1.25)) * 1.6, 0, 1);
    } else if (fr.state === "swim") {
      stretch = 0.35 + 0.65 * Math.max(0, Math.sin(fr.kick * Math.PI * 2));
    }
    const squash = fr.land > 0 ? 1 - Math.sin((fr.land / 0.25) * Math.PI) * 0.1 : 1;
    const grow = 1 + lift * 0.3;
    const shadowA = fr.state === "swim" ? 0.2 : 0.34 - lift * 0.16;
    const shadowArt = stretch > 0.5 ? leap : sit;
    const ride = fr.state === "sit" && fr.seat ? leafMove(fr.seat.leaf, fr.x, fr.y) : { x: fr.x, y: fr.y, rot: 0 };
    drawCritterShadow(shadowArt, ride.x + 2 + lift * 12, ride.y + 3 + lift * 18, fr.a + ride.rot, unit / shadowArt.meta.unit * (1 - lift * 0.2), shadowA);
    ctx.save();
    ctx.translate(ride.x, ride.y - (fr.jump ? lift * fr.jump.h * 0.35 : 0));
    ctx.rotate(fr.a + ride.rot);
    if (fr.state === "swim") ctx.globalAlpha = 0.85;
    const base = ctx.globalAlpha;
    [[sit, 1 - stretch], [leap, stretch]].forEach(([art, w]) => {
      if (w <= 0.02) return;
      const m = art.meta;
      const k = (unit * grow) / m.unit;
      ctx.save();
      ctx.globalAlpha = base * w;
      ctx.scale(k * (2 - squash), k * squash);
      drawMip(art.mips, k, -m.ax, -m.ay);
      ctx.restore();
    });
    if (fr.croak > 0) {
      const c = Math.sin((1 - fr.croak / 0.9) * Math.PI * 3) * 0.5 + 0.5;
      [-1, 1].forEach((s) => {
        const x = unit * 1.15;
        const y = s * unit * 0.62;
        const r = unit * (0.1 + c * 0.2);
        const sac = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
        sac.addColorStop(0, "rgba(226,232,196,0.75)");
        sac.addColorStop(1, "rgba(150,170,110,0.35)");
        ctx.globalAlpha = base;
        ctx.fillStyle = sac;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.restore();
  }

  function drawSplashes() {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    splashes.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y - p.z * 0.4, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  const RING_SIZES = [1, 2.5, 4.5, 7, 10, 14];
  let ringSprites = null;
  function makeRingSprite(r) {
    const scale = 3;
    const pad = 3;
    const c = makeCanvas((r * 2 + pad * 2) * scale, (r * 1.72 + pad * 2) * scale);
    const g = c.getContext("2d");
    g.scale(scale, scale);
    c.lw = r * 2 + pad * 2;
    c.lh = r * 1.72 + pad * 2;
    const cx = r + pad;
    const cy = r * 0.86 + pad;
    g.lineWidth = 0.9;
    g.strokeStyle = "rgb(236,252,250)";
    g.beginPath();
    g.ellipse(cx, cy, r, r * 0.86, 0, 0, Math.PI * 2);
    g.stroke();
    if (r > 1.5) {
      g.strokeStyle = "rgba(18,74,82,0.45)";
      g.beginPath();
      g.ellipse(cx, cy + 0.4, r * 0.72, r * 0.62, 0, 0, Math.PI * 2);
      g.stroke();
    }
    return c;
  }

  function drawRings() {
    if (!rings.length) return;
    if (!ringSprites) ringSprites = RING_SIZES.map(makeRingSprite);
    ctx.save();
    rings.forEach((r) => {
      if (r.wait > 0) return;
      const life = 1 - r.r / r.max;
      const a = r.a * Math.pow(life, 1.1);
      if (a < 0.02 || r.r < 0.5) return;
      let k = 0;
      while (k + 1 < RING_SIZES.length && RING_SIZES[k + 1] <= r.r) k++;
      const sp = ringSprites[k];
      const s = r.r / RING_SIZES[k];
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(sp, r.x - sp.lw * s / 2, r.y - sp.lh * s / 2, sp.lw * s, sp.lh * s);
    });
    ctx.restore();
  }

  function drawRainBits() {
    if (!rainBits.length) return;
    ctx.fillStyle = "rgba(240,250,252,0.8)";
    ctx.beginPath();
    rainBits.forEach((p) => {
      ctx.moveTo(p.x + p.r, p.y - p.z * 0.4);
      ctx.arc(p.x, p.y - p.z * 0.4, p.r, 0, Math.PI * 2);
    });
    ctx.fill();
  }

  let rainPattern = null;
  function drawRain(t) {
    if (!drops.length) return;
    const push = windPush();
    ctx.save();
    if (state.effect === "rain" && rainTex) {
      if (!rainPattern) rainPattern = ctx.createPattern(rainTex, "repeat");
      [[1300, 0.6, 1]].forEach(([speed, alpha, sc], i) => {
        const off = (t * speed) % (256 * sc);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate((t * push * 1.4 + i * 97) % (256 * sc), off);
        ctx.scale(sc, sc);
        ctx.fillStyle = rainPattern;
        ctx.fillRect(-256, -256, W / sc + 512, H / sc + 512);
        ctx.restore();
      });
    }
    if (!streakSprites || streakSprites.key !== push) streakSprites = makeStreaks(push);
    drops.forEach((d) => {
      const sp = streakSprites[d.z < 0.7 ? 0 : d.z < 1.05 ? 1 : 2];
      ctx.drawImage(sp, d.x - sp.ax, d.y - sp.ay, sp.lw, sp.lh);
    });
    ctx.restore();
  }

  let streakSprites = null;
  function makeStreaks(push) {
    const list = [0.5, 0.88, 1.28].map((z) => {
      const len = 10 + z * 30;
      const slant = (push * (0.8 + z) * 1.6) / (760 + z * 860);
      const dx = slant * len;
      const pad = 2;
      const scale = 2;
      const lw = Math.abs(dx) + pad * 2;
      const lh = len + pad * 2;
      const c = makeCanvas(lw * scale, lh * scale);
      const g = c.getContext("2d");
      g.scale(scale, scale);
      const x0 = pad + Math.max(0, dx);
      const grad = g.createLinearGradient(0, pad + len, 0, pad);
      grad.addColorStop(0, "rgba(236,246,250," + (0.18 + z * 0.36).toFixed(3) + ")");
      grad.addColorStop(1, "rgba(236,246,250,0)");
      g.strokeStyle = grad;
      g.lineCap = "round";
      g.lineWidth = 0.55 + z * 0.9;
      g.beginPath();
      g.moveTo(x0, pad + len);
      g.lineTo(x0 - dx, pad);
      g.stroke();
      c.lw = lw;
      c.lh = lh;
      c.ax = x0;
      c.ay = pad + len;
      return c;
    });
    list.key = push;
    return list;
  }

  function drawFlakes() {
    if (!flakes.length || !flakeSprite) return;
    ctx.save();
    flakes.forEach((d) => {
      if (d.r < 1.5) {
        ctx.globalAlpha = 0.45 + d.z * 0.3;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      const near = d.z > 1.15;
      const s = d.r * (near ? 3.6 : 2.8);
      if (d.z > 0.8 && flakeShadow) {
        ctx.globalAlpha = 0.16;
        ctx.drawImage(flakeShadow, d.x - s * 0.5 + 1, d.y - s * 0.5 + 1.5, s, s);
      }
      ctx.globalAlpha = near ? 0.7 : 0.92;
      ctx.translate(d.x, d.y);
      ctx.rotate(d.spin);
      ctx.drawImage(flakeSprite, -s / 2, -s * 0.42, s, s * 0.84);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ctx.restore();
  }

  function refreshClock() {
    if (state.timeMode !== "auto") {
      const arc = dayArc();
      const fixed = {
        dawn: arc.rise + 0.45,
        noon: (arc.rise + arc.set) / 2,
        dusk: arc.set - 0.3,
        night: arc.set + 4,
      }[state.timeMode];
      if (fixed !== undefined) {
        state.hour = fixed % 24;
        return;
      }
      if (state.timeMode === "fast") {
        const span = arc.rise + 24 - arc.set + 0.8;
        const f = ((performance.now() / 1000) % 60) / 60;
        state.hour = (arc.set - 0.4 + f * span) % 24;
        return;
      }
    }
    const now = Date.now();
    if (now - state.clockAt < 1000) return;
    state.clockAt = now;
    try {
      const parts = {};
      new Intl.DateTimeFormat("en-GB", {
        timeZone: state.tz,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date()).forEach((p) => { parts[p.type] = p.value; });
      state.hour = Number(parts.hour) + Number(parts.minute || 0) / 60;
    } catch (err) {
      const d = new Date();
      state.hour = d.getHours() + d.getMinutes() / 60;
    }
  }

  function dayArc() {
    const month = new Date().getMonth();
    const season = Math.cos(((month - 5) * Math.PI) / 6);
    return { rise: 6.2 - season * 0.85, set: 18.15 + season * 0.95 };
  }

  function skyLight() {
    refreshClock();
    const arc = dayArc();
    const hour = state.hour;
    const day = hour >= arc.rise && hour < arc.set;
    const p = day ? clamp((hour - arc.rise) / (arc.set - arc.rise), 0, 1) : 0;
    const alt = day ? Math.sin(p * Math.PI) : 0;
    let night = 0;
    if (hour < arc.rise - 0.7 || hour > arc.set + 0.7) night = 1;
    else if (hour < arc.rise) night = clamp((arc.rise - hour) / 0.7, 0, 1);
    else if (hour > arc.set) night = clamp((hour - arc.set) / 0.7, 0, 1);
    return { day, p, alt, night, hour };
  }

  // The moon crosses the meridian about 50 minutes later each day: noon at new moon, midnight at full.
  function moonSky(hour, phase) {
    const span = 6.2;
    let h = hour - (12 + phase * 24);
    h -= Math.round(h / 24) * 24;
    if (Math.abs(h) >= span) return null;
    const q = (h + span) / (span * 2);
    return { q, alt: Math.sin(q * Math.PI) };
  }

  function waveAt(y, t) {
    return Math.sin(y * 0.05 + t * 1.25) * 2.5
      + Math.sin(y * 0.019 - t * 0.68) * 1.6
      + Math.sin(y * 0.008 + t * 0.3) * 1.05;
  }

  function drawLivingWater(t) {
    const src = pondBase || bg;
    if (!src) return;
    ctx.save();
    const band = 4;
    for (let y = 0; y < H; y += band) {
      const shift = waveAt(y, t);
      const sy = Math.max(0, Math.min(H - band, y));
      ctx.drawImage(src, 0, sy, W, band, shift - 6, y, W + 12, band);
    }
    ctx.restore();
  }

  function drawCrestGlitter(t, x0, rgb) {
    for (let i = 0; i < 12; i++) {
      const y = H * (0.2 + i * 0.058);
      const phase = y * 0.05 + t * 1.25;
      const crest = Math.pow(Math.max(0, Math.sin(phase)), 2);
      const shift = waveAt(y, t);
      const gx = x0 + shift * 0.85;
      if (!inWater(gx, y) || coverAt(gx, y)) continue;
      const rw = 16 + i * 4 + crest * 14;
      const rh = 5 + crest * 4;
      const a = 0.04 + crest * 0.2;
      const g = ctx.createRadialGradient(gx, y, 0, gx, y, rw);
      g.addColorStop(0, "rgba(" + rgb.join(",") + "," + a.toFixed(3) + ")");
      g.addColorStop(0.5, "rgba(" + rgb.join(",") + "," + (a * 0.35).toFixed(3) + ")");
      g.addColorStop(1, "rgba(" + rgb.join(",") + ",0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(gx, y, rw, rh, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSunOnWater(t, light) {
    const p = light.p;
    const x = W * (0.08 + p * 0.84);
    const warm = p < 0.22 ? [255, 176, 92] : p > 0.78 ? [255, 112, 58] : [255, 236, 196];
    const alpha = (0.1 + light.alt * 0.16) * (state.effect === "wind" ? 0.65 : 1);
    ctx.save();
    const veil = ctx.createLinearGradient(0, 0, W, 0);
    if (p < 0.35) {
      veil.addColorStop(0, "rgba(" + warm.join(",") + "," + (0.16 + light.alt * 0.08).toFixed(3) + ")");
      veil.addColorStop(0.55, "rgba(255,244,220,0.03)");
      veil.addColorStop(1, "rgba(18,48,62,0.16)");
    } else if (p > 0.65) {
      veil.addColorStop(0, "rgba(18,48,62,0.16)");
      veil.addColorStop(0.45, "rgba(255,220,180,0.03)");
      veil.addColorStop(1, "rgba(" + warm.join(",") + "," + (0.2 + (1 - light.alt) * 0.08).toFixed(3) + ")");
    } else {
      veil.addColorStop(0, "rgba(20,60,70,0.08)");
      veil.addColorStop(0.5, "rgba(255,248,230,0.1)");
      veil.addColorStop(1, "rgba(20,60,70,0.08)");
    }
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 16; i++) {
      const y = H * (0.18 + i * 0.046);
      const drift = Math.sin(t * 1.6 + i * 0.7) * (10 + i);
      const gx = x + drift * (0.25 + (1 - light.alt));
      if (!inWater(gx, y) || coverAt(gx, y)) continue;
      const rw = (18 + i * 3.2) * (0.55 + light.alt * 0.7);
      const rh = 5 + light.alt * 3;
      const g = ctx.createRadialGradient(gx, y, 0, gx, y, rw);
      g.addColorStop(0, "rgba(" + warm.join(",") + "," + (alpha * (1 - i / 20)).toFixed(3) + ")");
      g.addColorStop(1, "rgba(" + warm.join(",") + ",0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(gx, y, rw, rh, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    drawCrestGlitter(t, x, warm);
    ctx.restore();
  }

  const SYNODIC_DAYS = 29.530588853;
  const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14);
  const MOON_PHASES = { crescent: 0.13, first: 0.25, full: 0.5, last: 0.75, waning: 0.87 };
  // [u, v, radius, depth] in moon-radius units, north up
  const MOON_MARIA = [
    [-0.55, -0.02, 0.36, 0.5],
    [-0.28, -0.42, 0.27, 0.6],
    [0.16, -0.42, 0.17, 0.58],
    [0.3, -0.12, 0.2, 0.58],
    [0.68, -0.3, 0.11, 0.6],
    [0.55, 0.12, 0.14, 0.48],
    [-0.18, 0.35, 0.2, 0.42],
    [-0.48, 0.38, 0.1, 0.48],
    [-0.05, -0.72, 0.12, 0.36],
    [0.4, 0.3, 0.09, 0.42],
    [0, -0.22, 0.1, 0.4],
  ];
  let moonFx = null;

  function moonPhase() {
    const fixed = MOON_PHASES[state.moonMode];
    if (fixed !== undefined) return fixed;
    const f = (Date.now() - NEW_MOON_EPOCH) / 86400000 / SYNODIC_DAYS;
    return f - Math.floor(f);
  }

  function hashNoise(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  function valueNoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hashNoise(ix, iy);
    const b = hashNoise(ix + 1, iy);
    const c = hashNoise(ix, iy + 1);
    const d = hashNoise(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  function moonAlbedo(u, v) {
    const wob = valueNoise(u * 5 + 3, v * 5 + 7) - 0.5;
    let dark = 0;
    for (let i = 0; i < MOON_MARIA.length; i++) {
      const m = MOON_MARIA[i];
      const du = u - m[0];
      const dv = v - m[1];
      const d = Math.sqrt(du * du + dv * dv) / m[2] + wob * 0.6;
      if (d < 1.4) dark = Math.max(dark, m[3] * clamp((1.4 - d) / 0.6, 0, 1));
    }
    const grain = (valueNoise(u * 14, v * 14) - 0.5) * 0.12 + (valueNoise(u * 34 + 9, v * 34) - 0.5) * 0.07;
    const tycho = Math.exp(-((u + 0.12) * (u + 0.12) + (v - 0.72) * (v - 0.72)) / 0.003) * 0.3;
    const copernicus = Math.exp(-((u + 0.3) * (u + 0.3) + (v + 0.1) * (v + 0.1)) / 0.002) * 0.2;
    return clamp(1 - dark * 0.45 + grain + tycho + copernicus, 0.3, 1.2);
  }

  function buildMoonSprite(R, phase) {
    const Rd = R * dpr;
    const reach = 3.8;
    const size = Math.ceil(Rd * reach * 2);
    const disc = makeCanvas(size, size);
    const dg = disc.getContext("2d");
    const img = dg.createImageData(size, size);
    const data = img.data;
    const k = Math.cos(phase * Math.PI * 2);
    const waxing = phase < 0.5;
    const half = size / 2;
    const aa = 1.1 / Rd;
    const j0 = Math.floor(half - Rd - 2);
    const j1 = Math.ceil(half + Rd + 2);
    for (let j = j0; j < j1; j++) {
      const v = (j + 0.5 - half) / Rd;
      for (let i = j0; i < j1; i++) {
        const u = (i + 0.5 - half) / Rd;
        const r = Math.sqrt(u * u + v * v);
        const edge = clamp((1 - r) / aa + 0.5, 0, 1);
        if (edge <= 0) continue;
        const z = Math.sqrt(Math.max(0, 1 - u * u - v * v));
        const limb = Math.sqrt(Math.max(0, 1 - v * v));
        const term = waxing ? u - k * limb : -k * limb - u;
        const lit = clamp(term / 0.07 + 0.5, 0, 1);
        if (lit <= 0) continue;
        const alb = moonAlbedo(u, v);
        const shade = (0.7 + 0.3 * Math.sqrt(z)) * Math.min(1, alb);
        const hi = clamp((alb - 0.6) / 0.45, 0, 1);
        const p = (j * size + i) * 4;
        data[p] = 222 + 33 * hi;
        data[p + 1] = 178 + 58 * hi;
        data[p + 2] = 104 + 76 * hi;
        data[p + 3] = edge * lit * clamp(shade, 0, 1) * 255;
      }
    }
    dg.putImageData(img, 0, 0);

    const c = makeCanvas(size, size);
    const g = c.getContext("2d");
    g.filter = "blur(" + (Rd * 0.9).toFixed(1) + "px) saturate(1.6)";
    g.globalAlpha = 0.9;
    g.drawImage(disc, 0, 0);
    g.drawImage(disc, 0, 0);
    g.filter = "blur(" + (Rd * 0.32).toFixed(1) + "px) saturate(1.4)";
    g.globalAlpha = 0.75;
    g.drawImage(disc, 0, 0);
    g.filter = "none";
    g.globalAlpha = 1;
    g.drawImage(disc, 0, 0);
    return c;
  }

  function drawMoonOnWater(t, light) {
    const phase = moonPhase();
    const illum = (1 - Math.cos(phase * Math.PI * 2)) / 2;
    if (illum < 0.025) return;
    const sky = moonSky(light.hour, phase);
    if (!sky) return;
    const fade = clamp(sky.alt / 0.18, 0, 1) * clamp(light.night * 1.5, 0, 1);
    if (fade < 0.01) return;
    const low = clamp((0.4 - sky.alt) / 0.4, 0, 1);
    const R = Math.round(clamp(Math.min(W, H) * 0.026, 14, 26));
    const key = R + ":" + dpr + ":" + phase.toFixed(3);
    if (!moonFx || moonFx.key !== key) moonFx = { key, sprite: buildMoonSprite(R, phase), layer: null };
    const sprite = moonFx.sprite;
    const sz = sprite.width / dpr;
    const pad = 4;
    const x = W * (0.34 + sky.q * 0.34);
    const y0 = H * (0.4 - sky.alt * 0.24);
    const lx = x - sz / 2 - pad;
    const ly = y0 - sz / 2;
    const lw = sz + pad * 2;
    const pw = Math.ceil(lw * dpr);
    const ph = sprite.height;
    if (!moonFx.layer || moonFx.layer.width !== pw || moonFx.layer.height !== ph) moonFx.layer = makeCanvas(pw, ph);
    const lg = moonFx.layer.getContext("2d");
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = "source-over";
    lg.clearRect(0, 0, pw, ph);
    lg.setTransform(dpr, 0, 0, dpr, 0, 0);
    lg.imageSmoothingEnabled = true;
    const sway = Math.sin(t * 0.5) * 0.35 + Math.sin(t * 0.23 + 1.1) * 0.25;
    const breathe = 1 + Math.sin(t * 0.8) * 0.006;
    lg.drawImage(sprite, pad + sway + (sz - sz * breathe) / 2, (sz - sz * breathe) / 2, sz * breathe, sz * breathe);

    if (cover) {
      const sx = cover.w / W;
      const sy = cover.h / H;
      const x0 = Math.max(0, lx);
      const y1 = Math.max(0, ly);
      const x1 = Math.min(W, lx + lw);
      const y2 = Math.min(H, ly + sz);
      if (x1 > x0 && y2 > y1) {
        lg.globalCompositeOperation = "destination-out";
        lg.drawImage(cover.canvas, x0 * sx, y1 * sy, (x1 - x0) * sx, (y2 - y1) * sy, x0 - lx, y1 - ly, x1 - x0, y2 - y1);
        lg.globalCompositeOperation = "source-over";
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const amb = ctx.createRadialGradient(x, y0, 0, x, y0, Math.max(W, H) * 0.5);
    amb.addColorStop(0, "rgba(150,132,104," + ((0.05 + 0.1 * illum) * fade).toFixed(3) + ")");
    amb.addColorStop(1, "rgba(150,132,104,0)");
    ctx.fillStyle = amb;
    ctx.fillRect(0, 0, W, H);
    if (low > 0.01) ctx.filter = "sepia(" + (low * 0.7).toFixed(2) + ") saturate(" + (1 + low * 1.2).toFixed(2) + ") hue-rotate(-" + (low * 14).toFixed(1) + "deg)";
    ctx.globalAlpha = fade * (1 - low * 0.35);
    ctx.drawImage(moonFx.layer, lx, ly, lw, sz);
    ctx.restore();
  }

  function drawDayNight(t) {
    const light = skyLight();
    const clearSky = state.effect === "clear" || state.effect === "wind";
    if (clearSky && light.day && light.night < 0.85) drawSunOnWater(t, light);
    const dusk = light.day ? Math.max(0, 0.22 - light.alt) : 0;
    let veil = "rgba(0,0,0,0)";
    let alpha = 0;
    if (light.night > 0.05) {
      const k = Math.min(1, light.night * (state.effect === "clear" ? 1 : 1.08));
      const mix = (c) => Math.round(255 - k * (255 - c));
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgb(" + mix(70) + "," + mix(92) + "," + mix(128) + ")";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(18,28,48," + (0.14 * k).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (dusk > 0.02) {
      const evening = light.p > 0.5;
      alpha = dusk * 1.4;
      veil = evening
        ? "rgba(92,42,28," + (alpha * 0.55).toFixed(3) + ")"
        : "rgba(255,168,110," + (alpha * 0.28).toFixed(3) + ")";
    } else if (light.day && light.alt < 0.45 && light.p < 0.35) {
      veil = "rgba(255,186,120,0.06)";
    }
    if (veil !== "rgba(0,0,0,0)") {
      ctx.save();
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (state.effect === "clear" && !light.day) drawMoonOnWater(t, light);
  }

  function drawScene(t, dt) {
    ctx.clearRect(0, 0, W, H);
    const moving = leafS > 0.01 && pondBase && leafPieces.length;
    if (bg) {
      ctx.drawImage(moving ? pondBase : bg, 0, 0, W, H);
      drawLivingWater(t);
    }

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 18; i++) {
      const x = (Math.sin(t * 0.35 + i * 1.7) * 0.5 + 0.5) * W;
      const y = (Math.cos(t * 0.28 + i * 2.2) * 0.5 + 0.5) * H;
      const r = 50 + (i % 5) * 18;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, "rgba(210, 255, 230, 0.08)");
      glow.addColorStop(1, "rgba(180, 230, 200, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    turtles.forEach((tur) => { if (inWater(tur.x, tur.y) && !coverAt(tur.x, tur.y)) drawFloorShadow(tur); });
    fishes.forEach((f) => { if (inWater(f.x, f.y) && !coverAt(f.x, f.y)) drawFloorShadow(f); });
    turtles.forEach((tur) => { if (inWater(tur.x, tur.y)) drawTurtle(tur, t); });
    const ordered = fishes.filter((f) => inWater(f.x, f.y)).sort((a, b) => a.y - b.y);
    ordered.forEach((f) => drawKoi(f, t));
    frogs.forEach((fr) => drawFrog(fr, t, true));
    pellets.forEach(drawPellet);
    drawRings();
    if (moving) drawLeaves();
    else if (surface) ctx.drawImage(surface, 0, 0, W, H);
    if (snowLevel > 0 && snowDraw) ctx.drawImage(snowDraw, 0, 0, W, H);
    drawBubbles(t);

    ripples.forEach((r) => {
      if (!inWater(r.x, r.y) || coverAt(r.x, r.y)) return;
      ctx.strokeStyle = "rgba(255,255,255," + Math.min(r.a, 0.45).toFixed(3) + ")";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, Math.min(r.r, r.max || 34), Math.min(r.r, r.max || 34) * 0.86, r.rot || 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    frogs.forEach((fr) => drawFrog(fr, t, false));
    drawSplashes();

    butterflies.forEach((b) => drawButterfly(b, t));
    motes.forEach((m) => {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    });

    drawRainBits();
    drawRain(t);
    drawFlakes();
    if (state.effect === "fog" || state.effect === "drizzle") {
      fog.forEach((b, i) => {
        const x = (b.x + Math.sin(t * 0.15 + i) * 40) % W;
        const rad = ctx.createRadialGradient(x, b.y, 10, x, b.y, b.r);
        rad.addColorStop(0, "rgba(255,255,255,0.16)");
        rad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = rad;
        ctx.beginPath();
        ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    leaves.forEach((d) => {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.r);
      ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(d.r * 1.7 + d.p)));
      ctx.fillStyle = d.petal ? "rgba(246, 176, 196, 0.85)" : "rgba(118, 170, 92, 0.8)";
      ctx.beginPath();
      if (d.petal) ctx.ellipse(0, 0, 4.2 * d.s + 2, 2.6 * d.s + 1.2, 0, 0, Math.PI * 2);
      else ctx.ellipse(0, 0, 5.5 * d.s + 2, 2.2 * d.s + 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    drawDayNight(t);
    if (flash > 0) {
      const f = flash * (0.6 + 0.4 * Math.abs(Math.sin(flash * 18)));
      ctx.fillStyle = "rgba(235,242,255," + (f * 0.32).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    ctx.font = "600 13px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    floats.forEach((fl) => {
      const alpha = clamp(1 - fl.age / 1.3, 0, 1);
      ctx.fillStyle = "rgba(255,250,242," + alpha.toFixed(3) + ")";
      ctx.fillText(fl.text, fl.x, fl.y - fl.age * 22);
    });
    void dt;
  }

  function frame(ts) {
    const dt = Math.min(0.033, last ? (ts - last) / 1000 : 0.016);
    last = ts;
    const t = ts / 1000;
    updateGroups(dt);
    fishes.forEach((f) => steerFish(f, dt));
    updateTurtles(dt);
    updateFrogs(dt);
    updateButterflies(dt, t);
    pellets.forEach((p) => { p.age += dt; });
    pellets = pellets.filter((p) => !p.dead && p.age < p.life);
    ripples.forEach((r) => { r.r += dt * (r.grow || 36); r.a -= dt * 0.22; });
    ripples = ripples.filter((r) => r.a > 0 && r.r < (r.max || 28) && inWater(r.x, r.y));
    floats.forEach((fl) => { fl.age += dt; });
    floats = floats.filter((fl) => fl.age < 1.3);
    updateWeather(dt, t);
    updateLeaves(dt, t);
    drawScene(t, dt);
    const picked = mouse.inside ? pickFish(mouse.x, mouse.y) : null;
    if (picked !== hoverFish) {
      hoverFish = picked;
      paintTip();
    } else if (picked && tipEl) {
      tipEl.style.left = mouse.x + "px";
      tipEl.style.top = mouse.y + "px";
    }
    requestAnimationFrame(frame);
  }

  function pickFish(x, y) {
    let best = null;
    let bestD = 34;
    for (let i = 0; i < fishes.length; i++) {
      const f = fishes[i];
      const d = Math.hypot(f.x - x, f.y - y);
      const hit = 22 + f.scale * 16;
      if (d < hit && d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  function paintTip() {
    if (!tipEl) return;
    if (!hoverFish) {
      tipEl.classList.add("hidden");
      return;
    }
    const extra = hoverFish.eaten ? " · 吃到 " + hoverFish.eaten + " 粒" : "";
    tipEl.textContent = hoverFish.name + extra;
    tipEl.style.left = mouse.x + "px";
    tipEl.style.top = mouse.y + "px";
    tipEl.classList.remove("hidden");
  }

  function getRanking() {
    const list = fishes.map((f) => ({
      num: f.num,
      name: f.name,
      eaten: f.eaten,
      color: f.color || "#f4f1ea",
      custom: !!f.custom,
    })).sort((a, b) => b.eaten - a.eaten || a.num - b.num);
    const total = fishes.reduce((sum, f) => sum + f.eaten, 0);
    return { list: list.slice(0, 10), guests: fishes.length, total };
  }

  function getCustoms() {
    return fishes.filter((f) => f.custom).map((f) => {
      if (f.sprite && !f.thumb) f.thumb = f.sprite.toDataURL("image/png");
      return { num: f.num, name: f.name, src: f.thumb || f.src };
    });
  }

  function init(el) {
    canvas = el;
    ctx = canvas.getContext("2d");
    tipEl = document.getElementById("tip");
    buildWeatherArt();
    resize();
    spawn();
    loadCustoms();
    canvas.addEventListener("pointermove", (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.inside = true;
      mouse.movedAt = performance.now();
    });
    canvas.addEventListener("pointerleave", () => {
      mouse.inside = false;
      hoverFish = null;
      paintTip();
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const frog = frogHit(e.clientX, e.clientY);
      if (frog) {
        frog.croak = 0.9;
        floats.push({ x: frog.x, y: frog.y - 2.6 * frogSize() * frog.size, text: "呱！", age: 0 });
        if (frog.state === "sit") frogLeap(frog, { x: e.clientX, y: e.clientY });
        else {
          frog.a = Math.atan2(frog.y - e.clientY, frog.x - e.clientX);
          frog.kick = 0.2;
          addSplash(frog.x, frog.y, 0.5);
        }
        return;
      }
      feed(e.clientX, e.clientY);
      const hint = document.getElementById("hint");
      if (hint) hint.classList.add("fade");
    });
    window.addEventListener("resize", () => {
      clearTimeout(init._timer);
      init._timer = setTimeout(resize, 120);
    });
    requestAnimationFrame(frame);
  }

  window.Pond = {
    init,
    feed,
    setClock(tz) {
      if (tz) state.tz = tz;
      state.clockAt = 0;
    },
    setTimeMode(mode) {
      state.timeMode = mode || "auto";
      state.clockAt = 0;
    },
    setMoonMode(mode) {
      state.moonMode = mode || "auto";
    },
    setAtmosphere(next) {
      if (next.effect) {
        state.effect = next.effect;
        state.wind = Number(next.wind) || 0;
        const tint = document.getElementById("tint");
        if (tint) tint.className = state.effect;
      }
      if (next.tz) state.tz = next.tz;
      state.clockAt = 0;
    },
    addCustom(def) { return addCustom(def, true); },
    removeCustom,
    getRanking,
    getCustoms,
    koiClipPath,
    drawKoiPreview,
    exportPaint(view) { return paintFromView(view).toDataURL("image/png"); },
    set onEat(fn) { onEat = fn; },
    set onRoster(fn) { onRoster = fn; },
  };
})();
