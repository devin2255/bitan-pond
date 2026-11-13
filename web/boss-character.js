(function (root) {
  "use strict";

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ease = (t) => t * t * (3 - 2 * t);
  const characterScale = 1.25;
  const swimSizeFactor = 1.75;
  const danceSizeFactor = 1.25;
  const swimTargetHeight = 1.45 * swimSizeFactor;
  const danceTargetHeight = 1.65 * danceSizeFactor;
  const waterEntryHeight = (from, to, elapsed) => from + (to - from) * ease(clamp(elapsed / 0.85, 0, 1));
  function turnToward(from, to, progress) {
    let difference = (to - from) % (Math.PI * 2);
    if (difference > Math.PI) difference -= Math.PI * 2;
    if (difference < -Math.PI) difference += Math.PI * 2;
    return from + difference * ease(clamp(progress, 0, 1));
  }
  const setting = (key, fallback) => {
    try { const value = localStorage.getItem(key); return value == null ? fallback : value === "1"; }
    catch (_) { return fallback; }
  };
  const save = (key, value) => { try { localStorage.setItem(key, value ? "1" : "0"); } catch (_) {} };
  const storedOutfit = (key) => { try { return localStorage.getItem(key) === "floral" ? "floral" : "classic"; } catch (_) { return "classic"; } };
  const saveOutfit = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };

  function load(src) { const image = new Image(); image.src = src; return image; }
  function ready(image) { return !!image && image.complete && image.naturalWidth > 0; }

  function character(options = {}) {
    const a = options.activity || PondBossActivity.create();
    const isFriend = options.variant === "friend";
    const visibleKey = isFriend ? "bitan.friend.visible" : "bitan.boss.visible";
    const wardrobeKey = isFriend ? "bitan.friend.outfit" : "bitan.boss.outfit";
    const friendRest = isFriend ? load("friend-black-rest-v1.png") : null;
    const classicImages = isFriend ? { lying: friendRest, sitting: friendRest,
      swim: load("friend-black-swim-v1.png"), swimCycle: load("friend-black-swim-cycle-v2.png"),
      dive: load("friend-black-reaction-v1.png"),
      reaction: load("friend-black-reaction-rig-v1.png") } :
      { lying: load("boss-relax-v3.png"), sitting: load("boss-sitting.png"),
      middle: load("boss-transition.png"), cycle: load("boss-sit-cycle-v3.png"), swim: load("boss-swim.png"),
      swimCycle: load("boss-swim-cycle-v2.png"), foot: load("boss-foot-wiggle-v3.png"),
      scratch: load("boss-scratch-v3.png"), water: load("boss-water-v3.png"), climb: load("boss-climb-v3.png"),
      dive: load("boss-show-dive-v2.png"), dance: load("boss-show-dance-v1.png"), danceMore: load("boss-show-dance-more-v1.png") };
    let images = classicImages, floralImages = null, outfit = "classic", requestedOutfit = "classic", outfitRequest = 0;
    const dance = PondBossDance.create();
    const mermaidImage = load(isFriend ? "friend-mermaid-v2.png" : "boss-mermaid-v2.png");
    let pos = null;
    let active = setting(visibleKey, true);
    let sound = setting("bitan.boss.sound", false);
    let audio = null;
    let blendCanvas = null;
    let cycleCanvas = null;
    let swimCanvas = null;
    let atlasCanvas = null;
    let travelStart = null;
    let swimRadius = 0;
    let show = null, performanceRadius = 0;
    let showWanted = false;
    let showCenter = { x: 0, y: 0 };
    let showFormation = { ring: 0, radius: 0 };
    const choreography = { ring: 1, lotus: 0, heart: 0, double: 0, spiral: 0 };
    let duet = null, lastDuet = null, duetBlend = 0;
    let climbFromMermaid = false;

    function loadFloralImages() {
      if (floralImages) return floralImages;
      if (isFriend) {
        const rest = load("friend-floral-rest-v1.png");
        floralImages = { lying: rest, sitting: rest,
          swim: load("friend-floral-swim-v1.png"), swimCycle: load("friend-floral-swim-cycle-v1.png"),
          dive: load("friend-floral-dive-v1.png"), reaction: load("friend-floral-reaction-v1.png") };
        return floralImages;
      }
      const sitting = load("boss-floral-sitting-v1.png"), swimCycle = load("boss-floral-swim-cycle-v1.png");
      floralImages = { lying: load("boss-floral-relax-v2.png"), sitting, middle: sitting,
        cycle: load("boss-floral-cycle-v2.png"), swim: swimCycle, swimCycle,
        foot: load("boss-floral-foot-v2.png"), scratch: load("boss-floral-scratch-v2.png"),
        water: load("boss-floral-water-v2.png"), climb: load("boss-floral-climb-v1.png"),
        dive: load("boss-floral-dive-v2.png"), dance: load("boss-floral-dance-v1.png"),
        danceMore: load("boss-floral-dance-more-v1.png") };
      return floralImages;
    }
    function imageLoaded(image) {
      if (image.complete) return Promise.resolve(ready(image));
      return new Promise((resolve) => {
        image.addEventListener("load", () => resolve(ready(image)), { once: true });
        image.addEventListener("error", () => resolve(false), { once: true });
      });
    }
    async function setOutfit(value) {
      const next = value === "floral" ? "floral" : "classic", request = ++outfitRequest;
      requestedOutfit = next;
      if (next === "classic") { images = classicImages; outfit = next; saveOutfit(wardrobeKey, next); return true; }
      const candidate = loadFloralImages();
      const loaded = await Promise.all([...new Set(Object.values(candidate))].map(imageLoaded));
      if (request !== outfitRequest) return false;
      if (loaded.some((ok) => !ok)) { floralImages = null; requestedOutfit = outfit; saveOutfit(wardrobeKey, outfit); return false; }
      images = candidate; outfit = next; saveOutfit(wardrobeKey, next); return true;
    }
    if (storedOutfit(wardrobeKey) === "floral") setOutfit("floral");

    function setPosition(x, y, radius, rotation) {
      pos = { x, y, radius, rotation: rotation || 0 };
    }

    function swimPoint(t) {
      const r = pos.radius;
      const q = 1 - t;
      if (travelStart) {
        const dx = travelStart.x - pos.x, dy = travelStart.y - pos.y;
        const length = Math.hypot(dx, dy) || 1, nx = dx / length, ny = dy / length;
        const x0 = travelStart.x, y0 = travelStart.y;
        const x3 = pos.x + nx * r * 1.20, y3 = pos.y + ny * r * 1.20;
        const bend = Math.min(r * 0.65, length * 0.12);
        const x1 = x0 + (x3 - x0) * 0.38 - ny * bend;
        const y1 = y0 + (y3 - y0) * 0.38 + nx * bend;
        const x2 = x3 + nx * r * 0.8, y2 = y3 + ny * r * 0.8;
        const vx = 3 * (q * q * (x1 - x0) + 2 * q * t * (x2 - x1) + t * t * (x3 - x2));
        const vy = 3 * (q * q * (y1 - y0) + 2 * q * t * (y2 - y1) + t * t * (y3 - y2));
        return { x: q*q*q*x0 + 3*q*q*t*x1 + 3*q*t*t*x2 + t*t*t*x3,
          y: q*q*q*y0 + 3*q*q*t*y1 + 3*q*t*t*y2 + t*t*t*y3,
          angle: Math.atan2(vy, vx) + Math.PI / 2 };
      }
      const x0 = pos.x + r * 1.12, y0 = pos.y + r * 0.60;
      const x1 = pos.x + r * 3.9, y1 = pos.y + r * 0.80;
      const x2 = pos.x + r * 3.8, y2 = pos.y - r * 2.0;
      const x3 = pos.x + r * 1.20, y3 = pos.y - r * 0.15;
      const dx = 3 * (q * q * (x1 - x0) + 2 * q * t * (x2 - x1) + t * t * (x3 - x2));
      const dy = 3 * (q * q * (y1 - y0) + 2 * q * t * (y2 - y1) + t * t * (y3 - y2));
      return { x: q * q * q * x0 + 3 * q * q * t * x1 + 3 * q * t * t * x2 + t * t * t * x3,
        y: q * q * q * y0 + 3 * q * q * t * y1 + 3 * q * t * t * y2 + t * t * t * y3,
        angle: Math.atan2(dy, dx) + Math.PI / 2 };
    }

    function playWhip() {
      if (!sound) return;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        audio = audio || new AudioCtx();
        if (audio.state === "suspended") audio.resume().catch(() => {});
        const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.15), audio.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          const t = i / data.length;
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 4);
        }
        const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
        source.buffer = buffer; filter.type = "highpass"; filter.frequency.value = 900;
        gain.gain.value = 0.13;
        source.connect(filter); filter.connect(gain); gain.connect(audio.destination); source.start();
      } catch (_) { /* Sound is optional. */ }
    }

    function hit(x, y) {
      if (!active || !pos || show) return false;
      const dx = (x - pos.x) / (pos.radius * 0.55 * characterScale);
      const dy = (y - pos.y - (a.pose === "sitting" ? pos.radius * 0.12 : 0)) / (pos.radius * 0.95 * characterScale);
      if (dx * dx + dy * dy > 1 || !PondBossActivity.strike(a)) return false;
      playWhip();
      return true;
    }

    function hover(x, y) {
      if (!active || !pos || show || !["lying", "sitting", "changing", "scratch", "water"].includes(a.mode)) return false;
      return Math.pow((x - pos.x) / (pos.radius * 0.55 * characterScale), 2) + Math.pow((y - pos.y) / (pos.radius * 0.95 * characterScale), 2) <= 1;
    }

    function setPerformance(value, center, formation, partner) {
      showWanted = !!value;
      if (center) showCenter = { x: center.x, y: center.y };
      showFormation = formation || { ring: 0, radius: 0 };
      duet = showWanted && partner ? partner : null;
    }

    function update(dt, splash, chooseDestination = () => null) {
      if (!active || !pos || !ready(images.lying)) return;
      if (show || showWanted) {
        const total = PondBossDance.formationNames.reduce((sum, name) => sum + Math.max(0, Number(showFormation[name]) || 0), 0);
        if (total) {
          const blend = 1 - Math.exp(-Math.max(0, dt) * 2.8);
          PondBossDance.formationNames.forEach((name) => {
            const target = Math.max(0, Number(showFormation[name]) || 0) / total;
            choreography[name] += (target - choreography[name]) * blend;
          });
        }
      }
      if (!show && showWanted && a.mode === "swim") {
        dance.reset();
        const t = PondBossActivity.progress(a), cycles = a.duration / 1.5;
        const distance = (v) => v - 0.35 * Math.sin(v * cycles * Math.PI * 2) / (cycles * Math.PI * 2);
        const start = swimPoint(clamp(distance(t) / distance(1), 0, 1));
        const radius = swimRadius || pos.radius;
        performanceRadius = radius;
        const startHeight = waterEntryHeight(1.8 * 0.82, swimTargetHeight, a.elapsed);
        show = { phase: "toCenter", time: 0, start, radius, startHeight, fromSwim: true, duration: Math.max(3, Math.hypot(showCenter.x - start.x, showCenter.y - start.y) / 65) };
      }
      if (!show && showWanted && ["lying", "sitting", "changing", "scratch", "water"].includes(a.mode)) {
        dance.reset();
        const needsLie = a.mode === "sitting" || (a.mode === "changing" && a.pose === "sitting");
        performanceRadius = pos.radius;
        show = { phase: needsLie ? "prepare" : "dive", time: 0, radius: pos.radius, duration: needsLie ? 1.1 : 2.8 };
      }
      if (show) {
        a.clock += dt;
        if (show.phase === "prepare" || show.phase === "dive") {
          show.radius = pos.radius; performanceRadius = pos.radius;
        } else if (show.phase === "toCenter" || show.phase === "dance") {
          const target = duet && Number.isFinite(duet.radius) ? duet.radius : show.radius;
          performanceRadius += (target - performanceRadius) * (1 - Math.exp(-Math.max(0, dt) * 2.2));
        }
        dance.advance(dt);
        if (duet) lastDuet = duet;
        else if (lastDuet) lastDuet = { ...lastDuet, phase: lastDuet.phase + dt * dance.snapshot().tempo / 60 };
        duetBlend += ((duet ? 1 : 0) - duetBlend) * (1 - Math.exp(-Math.max(0, dt) * 3));
        if (show.phase === "toCenter") {
          const target = duet ? { x: showCenter.x + duet.point.x, y: showCenter.y + duet.point.y, angle: duet.point.angle } :
            { x: showCenter.x, y: showCenter.y, angle: 0 };
          if (!show.destination) show.destination = target;
          else {
            const blend = 1 - Math.exp(-Math.max(0, dt) * 3);
            show.destination.x += (target.x - show.destination.x) * blend;
            show.destination.y += (target.y - show.destination.y) * blend;
            let turn = (target.angle - show.destination.angle) % (Math.PI * 2);
            if (turn > Math.PI) turn -= Math.PI * 2;
            if (turn < -Math.PI) turn += Math.PI * 2;
            show.destination.angle += turn * blend;
          }
        }
        if (show.phase === "dance") {
          const solo = show.orbit.advance(dt, dance.snapshot().phase,
            { ...choreography, radius: showFormation.radius, clearance: showFormation.clearance }, show.radius);
          const target = duet ? { x: showCenter.x + duet.point.x, y: showCenter.y + duet.point.y, angle: duet.point.angle } :
            { x: showCenter.x + solo.x, y: showCenter.y + solo.y, angle: solo.angle };
          const blend = 1 - Math.exp(-Math.max(0, dt) * 4);
          show.point.x += (target.x - show.point.x) * blend;
          show.point.y += (target.y - show.point.y) * blend;
          let turn = (target.angle - show.point.angle) % (Math.PI * 2);
          if (turn > Math.PI) turn -= Math.PI * 2;
          if (turn < -Math.PI) turn += Math.PI * 2;
          show.point.angle += turn * blend;
        }
        show.time += dt;
        if (show.phase === "prepare" && !showWanted) { show = null; return; }
        if (show.phase === "prepare" && show.time >= show.duration) {
          show = { phase: "dive", time: 0, radius: show.radius, duration: 2.8 };
        } else if (show.phase === "dive" && show.time >= show.duration) {
          const start = { x: pos.x + pos.radius * 1.12, y: pos.y + pos.radius * 0.60, angle: pos.rotation + 0.4 };
          splash(start.x, start.y, 1);
          show = { phase: "toCenter", time: 0, start, radius: show.radius, startHeight: 1.8, duration: Math.max(3, Math.hypot(showCenter.x - start.x, showCenter.y - start.y) / 65) };
        } else if (show.phase === "toCenter" && show.time >= show.duration) {
          show = { phase: "dance", time: 0, radius: show.radius, duration: Infinity,
            orbit: PondBossDance.createOrbit(), point: show.destination || { x: showCenter.x, y: showCenter.y, angle: 0 } };
        } else if (show.phase === "dance" && !showWanted) {
          const start = { x: show.point.x, y: show.point.y };
          const radius = performanceRadius || show.radius;
          const startAngle = show.point.angle;
          const destination = chooseDestination();
          if (destination) {
            travelStart = start;
            swimRadius = radius;
            show = { phase: "return", time: 0, radius, startAngle, startHeight: danceTargetHeight, duration: Math.max(3.5, Math.hypot(destination.x - start.x, destination.y - start.y) / 65) };
          }
        } else if (show.phase === "return" && show.time >= show.duration) {
          swimRadius = show.radius;
          show = null;
          climbFromMermaid = true;
          a.mode = "climb"; a.pose = "sitting"; a.elapsed = 0; a.duration = 3.4;
        }
        return;
      }
      const previousMode = a.mode;
      if (previousMode === "climb" && climbFromMermaid) dance.advance(dt);
      const events = PondBossActivity.advance(a, dt);
      if (previousMode === "climb" && a.mode !== "climb") { swimRadius = 0; climbFromMermaid = false; }
      // The second friend has a dedicated resting sprite rather than borrowing
      // the first person's facial-featured sitting or gesture atlas.
      if (isFriend && ["scratch", "water", "sitting", "changing"].includes(a.mode)) {
        a.mode = "lying"; a.pose = "lying"; a.elapsed = 0; a.duration = 7; a.gesturesDone = 0;
      }
      if (events.includes("splash")) {
        travelStart = null;
        swimRadius = pos.radius;
        const p = swimPoint(0);
        splash(p.x, p.y, 1);
        const destination = chooseDestination();
        if (destination) {
          travelStart = { x: p.x, y: p.y };
          a.duration = Math.max(5.8, Math.hypot(destination.x - p.x, destination.y - p.y) / 55);
        }
      }
    }

    // Keep the face and torso intact; gently move the lower legs in place.
    function restSprite(g, image, pose, height, overlap = 1) {
      if (!ready(image)) return;
      const iw = image.naturalWidth, ih = image.naturalHeight;
      const width = height * iw / ih;
      const bands = 24, bh = ih / bands;
      for (let i = 0; i < bands; i++) {
        const sourceY = Math.max(0, i * bh - overlap), endY = Math.min(ih, (i + 1) * bh + overlap);
        const v = (i + 0.5) / bands;
        const leg = clamp((v - 0.62) / 0.38, 0, 1);
        const swing = isFriend ? Math.sin(a.clock * 2.2) * height * 0.035 * leg * leg :
          Math.sin(a.clock * 1.25 + (pose === "sitting" ? 0.8 : 0)) * height * 0.016 * leg * leg;
        const y = -height / 2 + (sourceY / ih) * height;
        const h = (endY - sourceY) / ih * height;
        if (pose === "sitting" && v > 0.66) {
          const half = iw / 2;
          g.drawImage(image, 0, sourceY, half, endY - sourceY, -width / 2 + swing, y, width / 2, h);
          g.drawImage(image, half, sourceY, half, endY - sourceY, -swing, y, width / 2, h);
        } else g.drawImage(image, 0, sourceY, iw, endY - sourceY, -width / 2 + swing, y, width, h);
      }
    }

    function swimmer(g, height) {
      if (ready(images.swimCycle) && typeof PondBossActivity.swimStroke === "function") {
        if (!swimCanvas) { swimCanvas = document.createElement("canvas"); swimCanvas.width = 512; swimCanvas.height = 512; }
        const image = images.swimCycle, b = swimCanvas.getContext("2d");
        const stroke = PondBossActivity.swimStroke(a.mode === "swim" ? a.elapsed : a.clock);
        const first = stroke.first, second = stroke.next, k = stroke.blend;
        const cw = image.naturalWidth / 4, ch = image.naturalHeight / 2;
        b.clearRect(0, 0, 512, 512);
        [[first, 1 - k], [second, k]].forEach(([index, alpha], i) => {
          if (alpha <= 0.001) return;
          b.save(); b.globalAlpha = alpha; b.globalCompositeOperation = i ? "lighter" : "source-over";
          b.drawImage(image, (index % 4) * cw + 1, Math.floor(index / 4) * ch + 1, cw - 2, ch - 2, 16, 16, 480, 480);
          b.restore();
        });
        const scale = height / 480;
        g.drawImage(swimCanvas, -256 * scale, -256 * scale, 512 * scale, 512 * scale);
        return;
      }
      if (isFriend && ready(images.swim) && typeof PondBossDanceRig !== "undefined") {
        const pose = PondBossActivity.swimPose(a.mode === "swim" ? a.elapsed : a.clock);
        if (PondBossDanceRig.draw(g, images.swim, pose, 0, 0, height, 0, { columns: 1, rows: 1 })) return;
      }
      const image = images.swim;
      if (!ready(image)) return;
      const iw = image.naturalWidth, ih = image.naturalHeight, width = height * iw / ih;
      const bands = 32, bh = ih / bands;
      const pulse = Math.sin(a.clock * 3.1);
      for (let i = 0; i < bands; i++) {
        const sy = Math.max(0, i * bh - 1), ey = Math.min(ih, (i + 1) * bh + 1);
        const v = (i + 0.5) / bands;
        const arm = Math.pow(clamp((0.34 - v) / 0.34, 0, 1), 1.2);
        const leg = Math.pow(clamp((v - 0.64) / 0.36, 0, 1), 1.2);
        const stretch = 1 + 0.22 * arm * pulse - 0.20 * leg * pulse;
        const y = -height / 2 + sy / ih * height, h = (ey - sy) / ih * height;
        // The central strip (including the head and back) remains fixed. Both
        // sides meet it exactly, so there are no detached arms or legs.
        const side = width * 0.40 * stretch, center = width * 0.20;
        g.drawImage(image, 0, sy, iw * 0.40, ey - sy, -center / 2 - side, y, side, h);
        g.drawImage(image, iw * 0.40, sy, iw * 0.20, ey - sy, -center / 2, y, center, h);
        g.drawImage(image, iw * 0.60, sy, iw * 0.40, ey - sy, center / 2, y, side, h);
      }
    }

    function drawAt(g, pose, x, y, height, angle, alpha) {
      if (alpha <= 0) return;
      g.save(); g.translate(x, y); g.rotate(angle || 0); g.globalAlpha *= alpha;
      if (pose === "swim") swimmer(g, height);
      else restSprite(g, images[pose], pose, height);
      g.restore();
    }

    function drawBlend(g, first, second, k, x, y, height, angle, radius) {
      if (!ready(images[first]) || !ready(images[second])) {
        drawAt(g, ready(images[second]) ? second : first, x, y, height, angle, 1);
        return;
      }
      if (!blendCanvas) { blendCanvas = document.createElement("canvas"); blendCanvas.width = 512; blendCanvas.height = 960; }
      const b = blendCanvas.getContext("2d"), artHeight = 720;
      const offset = (pose) => pose === "sitting" ? 0.12 : pose === "middle" ? 0.06 : 0;
      b.clearRect(0, 0, blendCanvas.width, blendCanvas.height);
      [[first, 1 - k], [second, k]].forEach(([pose, alpha], i) => {
        b.save(); b.translate(256, 480 + radius * offset(pose) * artHeight / height);
        b.globalAlpha = alpha; b.globalCompositeOperation = i ? "lighter" : "source-over";
        restSprite(b, images[pose], pose, artHeight, 0); b.restore();
      });
      const scale = height / artHeight;
      g.save(); g.translate(x, y); g.rotate(angle);
      g.drawImage(blendCanvas, -256 * scale, -480 * scale, 512 * scale, 960 * scale);
      g.restore();
    }

    function drawCycle(g, x, y, height, angle, progress) {
      if (!cycleCanvas) { cycleCanvas = document.createElement("canvas"); cycleCanvas.width = 512; cycleCanvas.height = 512; }
      const b = cycleCanvas.getContext("2d"), image = images.cycle;
      const frame = clamp(progress, 0, 1) * 7, first = Math.floor(frame), second = Math.min(7, first + 1);
      const k = ease(frame - first), cw = image.naturalWidth / 4, ch = image.naturalHeight / 2;
      b.clearRect(0, 0, 512, 512);
      [[first, 1 - k], [second, k]].forEach(([index, alpha], i) => {
        if (alpha <= 0.001) return;
        b.save(); b.globalAlpha = alpha; b.globalCompositeOperation = i ? "lighter" : "source-over";
        // The classic sheet's first-row feet extend just across the row
        // boundary. Avoid drawing those pixels above the second-row head.
        const trim = image === classicImages.cycle && index >= 4 ? 0.09 : 0;
        b.drawImage(image, (index % 4) * cw, (Math.floor(index / 4) + trim) * ch, cw, ch * (1 - trim),
          16, 16 + 480 * trim, 480, 480 * (1 - trim));
        b.restore();
      });
      const scale = height / 480;
      g.save(); g.translate(x, y); g.rotate(angle);
      g.drawImage(cycleCanvas, -256 * scale, -256 * scale, 512 * scale, 512 * scale);
      g.restore();
    }

    // Each atlas contains whole connected poses, so hands and feet do not
    // separate at the joints while adjacent frames blend.
    function drawAtlas(g, image, frame, count, loop, x, y, height, angle, alpha = 1, sequence = null) {
      if (!ready(image) || alpha <= 0) return false;
      if (!atlasCanvas) { atlasCanvas = document.createElement("canvas"); atlasCanvas.width = 512; atlasCanvas.height = 512; }
      const b = atlasCanvas.getContext("2d"), max = count - 1;
      const value = loop ? ((frame % count) + count) % count : clamp(frame, 0, max);
      const first = Math.floor(value), next = loop ? (first + 1) % count : Math.min(max, first + 1);
      // The show can move between more distinct whole-body poses. Keep the
      // overlap brief so arms and legs do not linger as detached ghosts.
      const fraction = value - first;
      const k = ease(sequence ? clamp((fraction - 0.44) / 0.12, 0, 1) : fraction);
      const cw = image.naturalWidth / 4, ch = image.naturalHeight / 2;
      b.clearRect(0, 0, 512, 512);
      [[first, 1 - k], [next, k]].forEach(([index, weight], i) => {
        if (weight <= 0.001) return;
        if (sequence) index = sequence[index];
        b.save(); b.globalAlpha = weight; b.globalCompositeOperation = i ? "lighter" : "source-over";
        b.drawImage(image, (index % 4) * cw + 1, Math.floor(index / 4) * ch + 1,
          cw - 2, ch - 2, 16, 16, 480, 480); b.restore();
      });
      const scale = height / 480;
      g.save(); g.translate(x, y); g.rotate(angle); g.globalAlpha *= alpha;
      g.drawImage(atlasCanvas, -256 * scale, -256 * scale, 512 * scale, 512 * scale);
      g.restore();
      return true;
    }

    function climbGeometry(t) {
      const start = swimPoint(1), k = ease(t);
      let turn = pos.rotation - start.angle;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      return { x: start.x + (pos.x - start.x) * k, y: start.y + (pos.y + pos.radius * 0.12 - start.y) * k,
        angle: start.angle + turn * ease(clamp((t - 0.45) / 0.55, 0, 1)),
        height: characterScale * (swimTargetHeight * (swimRadius || pos.radius) * (1 - k) + 1.8 * pos.radius * k) };
    }

    function drawClimber(g, t) {
      const p = climbGeometry(t);
      if (isFriend) {
        const settle = ease(clamp((t - 0.45) / 0.55, 0, 1));
        if (settle < 1) drawAt(g, "swim", p.x, p.y, p.height, p.angle, 1 - settle);
        if (settle > 0) drawAt(g, "lying", p.x, p.y, p.height, p.angle, settle);
        return;
      }
      if (!drawAtlas(g, images.climb, t * 7, 8, false, p.x, p.y, p.height, p.angle)) {
        drawAt(g, "swim", p.x, p.y, p.height, p.angle, 0.88);
      }
    }

    function drawMermaid(g, rhythm, x, y, height, angle, alpha = 1) {
      if (!ready(mermaidImage) || typeof PondBossDanceRig === "undefined" || alpha <= 0) return false;
      const pose = PondBossDance.mermaidPoseAt(rhythm.phase, choreography);
      if (lastDuet && duetBlend > 0.001) {
        const paired = PondBossDance.duetPoseAt(lastDuet.phase, choreography, lastDuet.role);
        for (const key of Object.keys(pose)) {
          let difference = paired[key] - pose[key];
          if (key === "tailPhase") difference -= Math.round(difference);
          pose[key] += difference * duetBlend;
        }
      }
      g.save(); g.globalAlpha *= alpha;
      const drawn = PondBossDanceRig.draw(g, mermaidImage, pose, x, y, height, angle,
        { columns: 1, rows: 1, mermaid: true });
      g.restore();
      return drawn;
    }

    function drawTailSplash(g, point, height, rhythm) {
      if (choreography.lotus < 0.01) return;
      const stage = (rhythm.phase / 4) % 1;
      const burst = Math.sin(Math.PI * clamp(stage / 0.42, 0, 1));
      if (burst <= 0.01) return;
      const x = point.x - Math.sin(point.angle) * height * 0.40;
      const y = point.y + Math.cos(point.angle) * height * 0.40;
      g.save(); g.globalAlpha *= burst * choreography.lotus * 0.65;
      g.strokeStyle = "#edfffa"; g.fillStyle = "#edfffa"; g.lineWidth = Math.max(0.7, height * 0.012);
      g.beginPath(); g.ellipse(x, y, height * (0.04 + stage * 0.10), height * (0.022 + stage * 0.055), 0, 0, Math.PI * 2); g.stroke();
      for (let i = -1; i <= 1; i++) {
        const dx = i * height * (0.04 + stage * 0.04), dy = -height * (0.04 + stage * 0.06) * (1 - Math.abs(i) * 0.2);
        g.beginPath(); g.ellipse(x + dx, y + dy, height * 0.012, height * 0.018, 0, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }

    function drawMermaidBubbles(g, point, height) {
      if (!lastDuet || duetBlend < 0.3) return;
      const move = PondBossDance.duetMoveAt(lastDuet.phase);
      if (move.name !== "同步转体") return;
      const t = clamp((move.within - 0.25) / 0.45, 0, 1);
      const alpha = Math.sin(Math.PI * t) * duetBlend * 0.6;
      if (alpha <= 0.01) return;
      const forwardX = Math.sin(point.angle), forwardY = -Math.cos(point.angle);
      const distance = height * (0.38 + t * 0.14);
      const x = point.x + forwardX * distance, y = point.y + forwardY * distance;
      const r = height * (0.018 + t * 0.09);
      g.save(); g.globalAlpha *= alpha; g.strokeStyle = "#eafffb";
      g.lineWidth = Math.max(0.7, height * 0.009);
      g.beginPath(); g.ellipse(x, y, r, r * 0.75, point.angle, 0, Math.PI * 2); g.stroke();
      g.restore();
    }

    function drawWater(g) {
      if (active && pos && show && ["toCenter", "dance", "return"].includes(show.phase)) {
        const t = clamp(show.time / show.duration, 0, 1), r = performanceRadius || show.radius || pos.radius;
        const rhythm = dance.snapshot();
        const rippleFactor = show.phase === "dance" ? waterEntryHeight(swimSizeFactor, danceSizeFactor, show.time) :
          show.phase === "return" ? waterEntryHeight(danceSizeFactor, swimSizeFactor, show.time) : swimSizeFactor;
        let point;
        if (show.phase === "dance") point = show.point;
        else if (show.phase === "return") {
          const next = swimPoint(ease(t));
          point = { x: next.x, y: next.y, angle: turnToward(show.startAngle, next.angle, show.time / 0.85) };
        }
        else {
          const destination = show.destination || { x: showCenter.x, y: showCenter.y, angle: 0 };
          const k = ease(t), dx = destination.x - show.start.x, dy = destination.y - show.start.y;
          const heading = Math.atan2(dy, dx) + Math.PI / 2;
          const startAngle = Number.isFinite(show.start.angle) ? show.start.angle : heading;
          const aligned = turnToward(startAngle, heading, show.time / 0.85);
          point = { x: show.start.x + dx * k, y: show.start.y + dy * k,
            angle: turnToward(aligned, destination.angle, 1 - (show.duration - show.time) / 0.85) };
        }
        g.save(); g.strokeStyle = "rgba(230,255,249,.65)"; g.lineWidth = Math.max(0.8, r * 0.025);
        for (let i = 0; i < 3; i++) {
          const wave = (rhythm.phase * 0.20 + i / 3) % 1;
          g.globalAlpha = (1 - wave) * (0.48 + rhythm.pulse * 0.16);
          g.beginPath(); g.ellipse(point.x, point.y, r * rippleFactor * (0.28 + wave * 1.15), r * rippleFactor * (0.18 + wave * 0.70), 0, 0, Math.PI * 2); g.stroke();
        }
        g.globalAlpha = 1;
        const height = show.phase === "dance" ? r * characterScale * waterEntryHeight(swimTargetHeight, danceTargetHeight, show.time) :
          r * characterScale * waterEntryHeight(show.startHeight, swimTargetHeight, show.time);
        const blend = show.fromSwim ? ease(clamp(show.time / 0.65, 0, 1)) : 1;
        if (blend < 1) drawAt(g, "swim", point.x, point.y, height, point.angle, 0.9 * (1 - blend));
        if (blend > 0 && !drawMermaid(g, rhythm, point.x, point.y, height, point.angle, blend))
          drawAt(g, "swim", point.x, point.y, height, point.angle, 0.9 * blend);
        if (show.phase === "dance") {
          drawTailSplash(g, point, height, rhythm);
          drawMermaidBubbles(g, point, height);
        }
        g.restore();
        return;
      }
      if (!active || !pos || !["swim", "climb"].includes(a.mode)) return;
      const t = PondBossActivity.progress(a);
      if (a.mode === "climb") return;
      // Each kick adds a little forward thrust followed by a short glide.
      const cycles = a.duration / 1.5;
      const distance = (v) => v - 0.35 * Math.sin(v * cycles * Math.PI * 2) / (cycles * Math.PI * 2);
      const travel = clamp(distance(t) / distance(1), 0, 1);
      const point = swimPoint(travel);
      const fade = 1;
      const r = swimRadius || pos.radius;
      g.save();
      g.strokeStyle = "rgba(227,255,248,0.48)";
      g.lineWidth = Math.max(1, r * 0.016);
      for (let i = 0; i < 2; i++) {
        const wave = (a.clock * 0.85 + i * 0.5) % 1;
        g.globalAlpha = (1 - wave) * 0.65 * fade;
        g.beginPath(); g.ellipse(point.x, point.y, r * swimSizeFactor * (0.25 + wave * 0.7), r * swimSizeFactor * (0.18 + wave * 0.43), 0, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
      const height = r * characterScale * waterEntryHeight(1.8 * 0.82, swimTargetHeight, a.elapsed);
      drawAt(g, "swim", point.x, point.y, height, point.angle, 0.88 * fade);
      // Wake trails the direction of travel rather than enclosing the figure.
      g.save(); g.translate(point.x, point.y); g.rotate(point.angle);
      g.globalAlpha = 0.46 * fade; g.strokeStyle = "#e8fff8"; g.lineWidth = Math.max(0.7, r * 0.018);
      [-1, 1].forEach((side) => {
        g.beginPath(); g.moveTo(side * r * 0.20 * swimSizeFactor, r * 0.35 * swimSizeFactor);
        g.quadraticCurveTo(side * r * 0.43 * swimSizeFactor, r * 0.62 * swimSizeFactor, side * r * 0.72 * swimSizeFactor, r * 0.70 * swimSizeFactor); g.stroke();
      });
      g.restore();
      g.restore();
    }

    function drawWhip(g, progress) {
      const r = pos.radius, sweep = ease(clamp((progress - 0.08) / 0.44, 0, 1));
      const alpha = ease(clamp(progress / 0.12, 0, 1)) * (1 - ease(clamp((progress - 0.74) / 0.26, 0, 1)));
      const startX = pos.x - r * 2.55, startY = pos.y - r * 1.72;
      const endX = pos.x - r * 1.05 + r * 1.18 * sweep;
      const endY = pos.y - r * 1.65 + r * 1.53 * sweep;
      g.save(); g.globalAlpha *= alpha; g.lineCap = "round"; g.lineJoin = "round";
      // A light outline keeps the lash visible against dark water and leaves.
      g.beginPath(); g.moveTo(startX, startY);
      g.bezierCurveTo(startX + r * 0.82, startY - r * (0.25 + sweep * 0.55),
        endX - r * (1.0 - sweep * 0.42), endY + r * (0.6 - sweep * 1.0), endX, endY);
      g.lineWidth = Math.max(4, r * 0.20); g.strokeStyle = "rgba(255,241,195,.85)"; g.stroke();
      g.lineWidth = Math.max(2.1, r * 0.105); g.strokeStyle = "#523123"; g.stroke();
      g.lineWidth = Math.max(0.8, r * 0.036); g.strokeStyle = "#e8b777"; g.stroke();
      // A short handle distinguishes the whip from a fleeting motion line.
      g.beginPath(); g.moveTo(startX - r * 0.24, startY - r * 0.12); g.lineTo(startX + r * 0.15, startY + r * 0.07);
      g.lineWidth = Math.max(4, r * 0.24); g.strokeStyle = "#3e241a"; g.stroke();
      g.lineWidth = Math.max(1.3, r * 0.07); g.strokeStyle = "#e5b879"; g.stroke();
      g.restore();

      const hit = clamp((progress - 0.40) / 0.32, 0, 1), flash = Math.sin(Math.PI * hit);
      if (flash <= 0) return;
      const x = pos.x + r * 0.12, y = pos.y - r * 0.12;
      const inner = r * (0.14 + hit * 0.06), outer = r * (0.33 + hit * 0.17);
      g.save(); g.globalAlpha *= flash * 0.95; g.lineCap = "round";
      g.strokeStyle = "#fff4b3"; g.lineWidth = Math.max(1.8, r * 0.06);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4 + 0.12;
        g.beginPath(); g.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
        g.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer); g.stroke();
      }
      g.restore();
    }

    function drawTop(g) {
      if (active && pos && show) {
        const r = pos.radius, t = clamp(show.time / show.duration, 0, 1);
        if (show.phase === "prepare") {
          if (ready(images.cycle)) drawCycle(g, pos.x, pos.y + r * 0.12 * (1 - t), r * 1.8 * characterScale, pos.rotation, 1 - ease(t));
          else drawAt(g, "lying", pos.x, pos.y, r * 1.8 * characterScale, pos.rotation, 1);
        } else if (show.phase === "dive") {
          const jump = ease(clamp((t - 0.48) / 0.52, 0, 1));
          const x = pos.x + r * 1.12 * jump, y = pos.y + r * 0.60 * jump - r * 0.25 * Math.sin(Math.PI * jump);
          const angle = pos.rotation + jump * 0.4, height = r * 1.8 * characterScale;
          const blend = ready(mermaidImage) ? ease(clamp((t - 0.72) / 0.28, 0, 1)) : 0;
          if (blend < 1 && !drawAtlas(g, images.dive, t * 7, 8, false, x, y, height, angle, 1 - blend))
            drawAt(g, "lying", x, y, height, angle, 1 - blend);
          if (blend > 0) drawMermaid(g, dance.snapshot(), x, y, height, angle, blend);
        }
        return;
      }
      if (!active || !pos || a.mode === "swim") return;
      const r = pos.radius, t = PondBossActivity.progress(a), breathing = 1 + Math.sin(a.clock * 1.1) * 0.008;
      let x = pos.x, y = pos.y, angle = pos.rotation, scale = 1;
      if (a.mode === "whip") {
        // React after contact, then settle at the starting point of the fall.
        const recoil = Math.sin(Math.PI * clamp((t - 0.36) / 0.64, 0, 1));
        x += r * 0.24 * recoil; y -= r * 0.20 * recoil;
        angle += 0.30 * recoil; scale += 0.10 * recoil;
      }
      if (a.mode === "fall") {
        const k = ease(t); x += r * 1.12 * k;
        y += r * 0.60 * k - r * 0.28 * Math.sin(Math.PI * t);
        angle = turnToward(pos.rotation, swimPoint(0).angle, clamp((t - 0.15) / 0.85, 0, 1));
        scale = 1 - 0.18 * k;
      }
      if (a.mode === "climb") {
        // Keep the body continuous across the leaf edge. A small wake at the
        // trailing legs shows which part is still in the water.
        const p = climbGeometry(t);
        const change = climbFromMermaid ? ease(clamp(t / 0.28, 0, 1)) : 1;
        if (change < 1) drawMermaid(g, dance.snapshot(), p.x, p.y, p.height, p.angle, 1 - change);
        if (change > 0) { g.save(); g.globalAlpha *= change; drawClimber(g, t); g.restore(); }
        const tx = p.x - Math.sin(p.angle) * p.height * 0.36;
        const ty = p.y + Math.cos(p.angle) * p.height * 0.36;
        if (Math.hypot(tx - pos.x, ty - pos.y) > r * 0.88) {
          const wave = (a.elapsed * 0.9) % 1;
          g.save(); g.globalAlpha = (1 - wave) * (1 - t) * 0.45;
          g.strokeStyle = "#e4fff7"; g.lineWidth = Math.max(0.7, r * 0.018);
          g.beginPath(); g.ellipse(tx, ty, r * (0.1 + wave * 0.25), r * (0.06 + wave * 0.13), 0, 0, Math.PI * 2); g.stroke(); g.restore();
        }
        return;
      }
      // A soft contact shadow makes the person sit on the leaf, rather than
      // appearing as a cutout floating above it.
      g.save();
      g.translate(x + r * 0.025, y + r * 0.04);
      g.rotate(angle); g.filter = "blur(" + Math.max(2, r * 0.045) + "px)";
      g.fillStyle = "rgba(20,35,22,0.28)";
      g.beginPath(); g.ellipse(0, 0, r * 0.34 * scale * characterScale, r * 0.72 * scale * characterScale, 0, 0, Math.PI * 2); g.fill();
      g.restore();
      if (a.mode === "whip" || a.mode === "fall") {
        const reaction = a.mode === "whip" ? ease(clamp((t - 0.41) / 0.07, 0, 1)) : 1;
        const phase = a.mode === "whip" ? clamp((t - 0.44) / 0.56, 0, 1) : 1 + t;
        const sprite = isFriend ? images.reaction : images.dance;
        const height = r * 1.8 * breathing * scale * characterScale;
        if (!ready(sprite) || typeof PondBossDanceRig === "undefined") drawAt(g, a.pose, x, y, height, angle, 1);
        else {
          if (reaction < 1) drawAt(g, a.pose, x, y, height, angle, 1 - reaction);
          if (reaction > 0) {
            g.save(); g.globalAlpha *= reaction;
            PondBossDanceRig.draw(g, sprite, PondBossActivity.reactionPose(phase), x, y, height, angle,
              { columns: isFriend ? 1 : 4, rows: isFriend ? 1 : 2 });
            g.restore();
          }
        }
        return;
      }
      if (a.mode === "changing") {
        if (ready(images.cycle)) {
          const progress = a.from === "lying" ? t : 1 - t;
          drawCycle(g, x, y + r * 0.12 * progress, r * 1.8 * breathing * characterScale, angle, progress);
        } else {
          const sequence = ready(images.middle) ? [a.from, "middle", a.to] : [a.from, a.to];
          const offset = (pose) => pose === "sitting" ? 0.12 : pose === "middle" ? 0.06 : 0;
          let first, second, k;
          if (sequence.length === 2) {
            first = sequence[0]; second = sequence[1]; k = ease(clamp((t - 0.43) / 0.14, 0, 1));
          } else if (t < 0.5) {
            first = sequence[0]; second = sequence[1]; k = ease(clamp((t - 0.23) / 0.14, 0, 1));
          } else {
            first = sequence[1]; second = sequence[2]; k = ease(clamp((t - 0.62) / 0.14, 0, 1));
          }
          const height = r * 1.8 * breathing * characterScale;
          if (k <= 0.001) drawAt(g, first, x, y + r * offset(first), height, angle, 1);
          else if (k >= 0.999) drawAt(g, second, x, y + r * offset(second), height, angle, 1);
          else drawBlend(g, first, second, k, x, y, height, angle, r);
        }
      } else if (a.mode === "lying" && ready(images.foot)) {
        drawAtlas(g, images.foot, (a.clock / 1.8) * 4, 4, true,
          x, y, r * 1.8 * breathing * characterScale, angle);
      } else if ((a.mode === "scratch" || a.mode === "water") && ready(images[a.mode])) {
        const lean = a.mode === "water" ? Math.sin(Math.PI * t) ** 2 * r * 0.28 : 0;
        const lx = x - Math.cos(angle) * lean, ly = y - Math.sin(angle) * lean;
        drawAtlas(g, images[a.mode], t * 7, 8, false, lx, ly, r * 1.8 * breathing * characterScale, angle);
      } else {
        drawAt(g, a.pose, x, y + (a.pose === "sitting" ? r * 0.12 : 0), r * 1.8 * breathing * scale * characterScale, angle, 1);
      }
      if (a.mode === "water" && t > 0.32 && t < 0.78) {
        const rx = -r, ry = -r * 0.02;
        const px = pos.x + rx * Math.cos(angle) - ry * Math.sin(angle);
        const py = pos.y + rx * Math.sin(angle) + ry * Math.cos(angle);
        const wave = (a.elapsed * 1.15) % 1;
        g.save(); g.globalAlpha = Math.sin((t - 0.32) / 0.46 * Math.PI) * (1 - wave) * 0.62;
        g.strokeStyle = "#e4fff7"; g.lineWidth = Math.max(0.7, r * 0.025);
        g.beginPath(); g.ellipse(px, py, r * (0.08 + wave * 0.22), r * (0.04 + wave * 0.12), 0, 0, Math.PI * 2); g.stroke(); g.restore();
      }
      if (a.mode === "sitting") {
        const wave = (a.clock * 0.48) % 1;
        g.save(); g.globalAlpha = (1 - wave) * 0.4; g.lineWidth = 1;
        g.strokeStyle = "#d6f8ec"; g.beginPath();
        g.ellipse(pos.x, pos.y + r * 0.96, r * (0.12 + wave * 0.18), r * (0.04 + wave * 0.07), 0, 0, Math.PI * 2); g.stroke(); g.restore();
      }
    }

    function drawInteraction(g) {
      if (active && pos && !show && a.mode === "whip") drawWhip(g, PondBossActivity.progress(a));
    }

    return {
      get enabled() { return active; }, get sound() { return sound; }, get outfit() { return requestedOutfit; },
      get ready() { return ready(images.lying) && ready(mermaidImage); },
      get danceState() { return dance.snapshot(); },
      setEnabled(value) {
        active = !!value;
        if (!active) { show = null; travelStart = null; swimRadius = 0; climbFromMermaid = false; duet = lastDuet = null; duetBlend = 0; a.mode = "lying"; a.pose = "lying"; a.elapsed = 0; a.duration = 6; }
        save(visibleKey, active);
      },
      setSound(value) { sound = !!value; save("bitan.boss.sound", sound); },
      setOutfit,
      setRhythmEnabled(value) { dance.setRhythmEnabled(value); },
      noteBeat(event) { dance.beat(event); },
      setPosition, clearPosition() { pos = null; }, setPerformance, update, hit, hover, drawWater, drawTop, drawInteraction,
    };
  }
  root.PondBossCharacter = { create: character };
})(window);
