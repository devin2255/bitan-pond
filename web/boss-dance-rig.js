(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PondBossDanceRig = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const xs = [0, 0.12, 0.22, 0.30, 0.36, 0.41, 0.46, 0.50, 0.54, 0.59, 0.64, 0.70, 0.78, 0.88, 1];
  const ys = [0, 0.13, 0.19, 0.23, 0.27, 0.31, 0.36, 0.45, 0.55, 0.61, 0.67, 0.74, 0.82, 0.91, 1];
  const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
  const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
  const vertices = [], cells = [], indices = new Map();

  function vertex(ix, iy, cellSide) {
    const u = xs[ix], side = u === 0.5 ? cellSide : (u < 0.5 ? -1 : 1);
    const key = ix + ":" + iy + ":" + side;
    if (!indices.has(key)) { indices.set(key, vertices.length); vertices.push({ u, v: ys[iy], side }); }
    return indices.get(key);
  }

  // Transparent corners are omitted; the original T-shaped figure stays in a
  // single connected mesh. The seam between the legs can open below the hips.
  for (let iy = 0; iy < ys.length - 1; iy++) {
    for (let ix = 0; ix < xs.length - 1; ix++) {
      const u0 = xs[ix], u1 = xs[ix + 1], v0 = ys[iy], v1 = ys[iy + 1];
      if (v1 <= 0.19 && (u1 < 0.30 || u0 > 0.70)) continue;
      if (v0 >= 0.36 && v0 < 0.70 && (u1 < 0.30 || u0 > 0.70)) continue;
      // The mermaid's single fin is wider than the original pair of legs.
      if (v0 >= 0.70 && (u1 < 0.16 || u0 > 0.84)) continue;
      const side = u1 <= 0.5 ? -1 : 1;
      cells.push({ u0, u1, v0, v1, p00: vertex(ix, iy, side), p10: vertex(ix + 1, iy, side),
        p01: vertex(ix, iy + 1, side), p11: vertex(ix + 1, iy + 1, side) });
    }
  }
  const positions = new Float64Array(vertices.length * 2);
  let gpu;

  function createGpu() {
    if (typeof document === "undefined") return null;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true });
      if (!gl || !gl.createShader) return null;
      const shader = (type, source) => {
        const value = gl.createShader(type); gl.shaderSource(value, source); gl.compileShader(value);
        if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error("Dance shader could not compile");
        return value;
      };
      const program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER,
        "attribute vec2 position; attribute vec2 uv; varying vec2 tex; void main(){ tex=uv; gl_Position=vec4((position.x-0.5)/0.75,(0.5-position.y)/0.75,0.0,1.0); }"));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER,
        "precision mediump float; varying vec2 tex; uniform sampler2D image; void main(){ gl_FragColor=texture2D(image,tex); }"));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Dance shader could not link");
      gl.useProgram(program);
      const positionBuffer = gl.createBuffer(), uvBuffer = gl.createBuffer(), indexBuffer = gl.createBuffer();
      const indices = new Uint16Array(cells.length * 6);
      cells.forEach((cell, i) => indices.set([cell.p00, cell.p10, cell.p01, cell.p11, cell.p01, cell.p10], i * 6));
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      const pos = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      const uv = gl.getAttribLocation(program, "uv"); gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      // Some transparent mesh triangles fold across a moving arm. Drawing
      // them without blending overwrites existing skin with transparent pixels
      // and makes sections of the arm disappear. Textures are premultiplied.
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      return { canvas, gl, positionBuffer, uvBuffer, textures: new WeakMap(), count: indices.length,
        positions: new Float32Array(vertices.length * 2), image: null, size: 0 };
    } catch (_) { return null; }
  }

  function drawGpu(g, image, x, y, height, angle, columns, rows) {
    if (gpu === undefined) gpu = createGpu();
    if (gpu && gpu.gl.isContextLost()) gpu = null;
    if (!gpu) return false;
    try {
      const { gl, canvas } = gpu;
      if (gpu.uvWidth !== image.naturalWidth || gpu.uvHeight !== image.naturalHeight || gpu.columns !== columns || gpu.rows !== rows) {
        const coords = new Float32Array(vertices.length * 2), cw = image.naturalWidth / columns, ch = image.naturalHeight / rows;
        for (let i = 0; i < vertices.length; i++) {
          coords[i * 2] = (1 + vertices[i].u * (cw - 2)) / image.naturalWidth;
          coords[i * 2 + 1] = (1 + vertices[i].v * (ch - 2)) / image.naturalHeight;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uvBuffer); gl.bufferData(gl.ARRAY_BUFFER, coords, gl.STATIC_DRAW);
        gpu.uvWidth = image.naturalWidth; gpu.uvHeight = image.naturalHeight; gpu.columns = columns; gpu.rows = rows;
      }
      // Two dancers alternate draws each frame. Keep one GPU texture per
      // image instead of repeatedly uploading both full-resolution sprites.
      let texture = gpu.textures.get(image);
      if (!texture) {
        texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        if (gl.getError() !== gl.NO_ERROR) throw new Error("Dance image could not be uploaded");
        gpu.textures.set(image, texture);
      } else gl.bindTexture(gl.TEXTURE_2D, texture);
      const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      const required = Math.max(128, Math.ceil(height * 1.5 * dpr));
      // Keep the larger backing buffer when dancers have different sizes.
      const size = Math.max(gpu.size, Math.min(512, 2 ** Math.ceil(Math.log2(required))));
      if (gpu.size !== size) { canvas.width = size; canvas.height = size; gpu.size = size; gl.viewport(0, 0, size, size); }
      gpu.positions.set(positions);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.positionBuffer); gl.bufferData(gl.ARRAY_BUFFER, gpu.positions, gl.DYNAMIC_DRAW);
      gl.clear(gl.COLOR_BUFFER_BIT); gl.drawElements(gl.TRIANGLES, gpu.count, gl.UNSIGNED_SHORT, 0);
      g.save(); g.translate(x, y); g.rotate(angle || 0); g.globalAlpha *= 0.96;
      g.drawImage(canvas, -height * 0.75, -height * 0.75, height * 1.5, height * 1.5); g.restore();
      return true;
    } catch (_) { gpu = null; return false; }
  }

  function deform(u, v, side, pose, mermaid = false) {
    let x = u, y = v;
    // The mermaid's arms occupy a wider band than the original atlas. Give
    // the whole arm the same shoulder motion, including its upper edge, so a
    // stronger stroke does not stretch a fixed strip across the shoulder.
    const armWeight = mermaid ?
      smooth((Math.abs(u - 0.5) - 0.095) / 0.10) * smooth((v - 0.15) / 0.04) * (1 - smooth((v - 0.34) / 0.045)) :
      smooth((Math.abs(u - 0.5) - 0.10) / 0.11) * smooth((v - 0.19) / 0.055) * (1 - smooth((v - 0.30) / 0.065));
    if (armWeight > 0) {
      const shoulderX = 0.5 + side * 0.115, shoulderY = mermaid ? 0.245 : 0.265;
      const elbowX = 0.5 + side * 0.26, elbowY = mermaid ? 0.25 : 0.275;
      const elbow = side < 0 ? pose.elbowLeft : pose.elbowRight;
      const elbowWeight = smooth(((u - elbowX) * side) / 0.05);
      const ea = -side * elbow * elbowWeight, ec = Math.cos(ea), es = Math.sin(ea);
      const ex = u - elbowX, ey = v - elbowY;
      const forearmX = elbowX + ex * ec - ey * es, forearmY = elbowY + ex * es + ey * ec;
      const arm = side < 0 ? pose.armLeft : pose.armRight;
      const angle = -side * arm, c = Math.cos(angle), s = Math.sin(angle);
      const dx = forearmX - shoulderX, dy = forearmY - shoulderY;
      x += (shoulderX + dx * c - dy * s - u) * armWeight;
      y += (shoulderY + dx * s + dy * c - v) * armWeight;
    }

    const legWeight = smooth((v - 0.59) / 0.11);
    if (mermaid) {
      // One continuous wave travels down the connected tail and reaches the
      // fin later than the hips. Both sides of the centre seam move together.
      const weight = smooth((v - 0.43) / 0.57);
      const phase = (pose.tailPhase || 0) * Math.PI * 2 - (v - 0.43) * 4.2;
      const amplitude = Number.isFinite(pose.tailAmplitude) ? pose.tailAmplitude : 0.115;
      const bodyWave = Number.isFinite(pose.bodyWave) ? pose.bodyWave : 0;
      x += (amplitude * weight * weight + bodyWave * smooth((v - 0.30) / 0.70)) * Math.sin(phase);
      y += 0.012 * weight * Math.cos(phase);
    } else if (legWeight > 0) {
      const hipX = 0.5 + side * 0.055, hipY = 0.61, kneeY = 0.76;
      const leg = side < 0 ? pose.legLeft : pose.legRight;
      const kick = side < 0 ? pose.kickLeft : pose.kickRight;
      // In a frog kick, the knees open and the heels fold back toward the
      // body. Rotate each lower leg around its knee rather than just scaling
      // its length, then let the hip carry the entire leg outward.
      const kneeWeight = smooth((v - kneeY) / 0.07);
      const kneeAngle = side * kick * 0.95, kc = Math.cos(kneeAngle), ks = Math.sin(kneeAngle);
      const kx = u - hipX, ky = v - kneeY;
      const bentX = u + (hipX + kx * kc - ky * ks - u) * kneeWeight;
      const bentY = v + (kneeY + kx * ks + ky * kc - v) * kneeWeight;
      const angle = -side * leg, c = Math.cos(angle), s = Math.sin(angle);
      const dx = bentX - hipX, dy = bentY - hipY;
      x += (hipX + dx * c - dy * s - u) * legWeight;
      y += (hipY + dx * s + dy * c - v) * legWeight;
    }
    const torso = smooth((v - 0.18) / 0.27) * (1 - smooth((v - 0.65) / 0.30));
    x += pose.bodySway * torso;
    return { x, y };
  }

  function clipTriangle(g, ax, ay, bx, by, cx, cy, overlap) {
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3;
    const grow = (x, y) => {
      const dx = x - mx, dy = y - my, length = Math.hypot(dx, dy) || 1;
      return [x + dx * overlap / length, y + dy * overlap / length];
    };
    const a = grow(ax, ay), b = grow(bx, by), c = grow(cx, cy);
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath(); g.clip();
  }

  function draw(g, image, pose, x, y, height, angle, options = {}) {
    if (!image || !image.complete || !(image.naturalWidth > 0) || !pose || !(height > 0)) return false;
    const columns = options.columns || 4, rows = options.rows || 2;
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i], p = deform(v.u, v.v, v.side, pose, !!options.mermaid);
      positions[i * 2] = p.x; positions[i * 2 + 1] = p.y;
    }
    if (!options.forceCanvas && drawGpu(g, image, x, y, height, angle, columns, rows)) {
      if (options.onRenderer) options.onRenderer("webgl");
      return true;
    }
    if (options.onRenderer) options.onRenderer("canvas");
    const sourceWidth = image.naturalWidth / columns, sourceHeight = image.naturalHeight / rows;
    const overlap = 0.35 / height;
    g.save(); g.translate(x, y); g.rotate(angle || 0); g.scale(height, height); g.translate(-0.5, -0.5);
    g.globalAlpha *= 0.96;
    for (const cell of cells) {
      const { u0, u1, v0, v1, p00, p10, p01, p11 } = cell;
      const ax = positions[p00 * 2], ay = positions[p00 * 2 + 1];
      const bx = positions[p10 * 2], by = positions[p10 * 2 + 1];
      const cx = positions[p01 * 2], cy = positions[p01 * 2 + 1];
      const dx = positions[p11 * 2], dy = positions[p11 * 2 + 1];
      const du = u1 - u0, dv = v1 - v0;
      let a = (bx - ax) / du, b = (by - ay) / du, c = (cx - ax) / dv, d = (cy - ay) / dv;
      g.save(); clipTriangle(g, ax, ay, bx, by, cx, cy, overlap);
      g.transform(a, b, c, d, ax - a * u0 - c * v0, ay - b * u0 - d * v0);
      g.drawImage(image, 1, 1, sourceWidth - 2, sourceHeight - 2, 0, 0, 1, 1); g.restore();
      a = (dx - cx) / du; b = (dy - cy) / du; c = (dx - bx) / dv; d = (dy - by) / dv;
      g.save(); clipTriangle(g, dx, dy, cx, cy, bx, by, overlap);
      g.transform(a, b, c, d, dx - a * u1 - c * v1, dy - b * u1 - d * v1);
      g.drawImage(image, 1, 1, sourceWidth - 2, sourceHeight - 2, 0, 0, 1, 1); g.restore();
    }
    g.restore();
    return true;
  }

  return { draw, deform };
});
