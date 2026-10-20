(function () {
  const NAMES = ["小满", "青团", "赤鲤", "墨白", "荷叶", "铃音", "黄金", "白金", "丹顶", "青花", "胭脂", "素雪", "金鳞", "碧波", "雨荷", "云锦", "琥珀", "月白", "朱砂", "松烟", "桃夭", "竹青", "兰舟", "星河", "晚霞", "朝露", "桂花", "荔枝", "石榴", "银杏"];
  const CITIES = [
    ["北京", 39.9042, 116.4074],
    ["上海", 31.2304, 121.4737],
    ["广州", 23.1291, 113.2644],
    ["深圳", 22.5431, 114.0579],
    ["杭州", 30.2741, 120.1551],
    ["成都", 30.5728, 104.0668],
  ];
  const COLORS = ["#e23b32", "#e0a12e", "#2b2b2b", "#6d8ea3"];
  const DEMO = [
    ["auto", "自动天气"],
    ["clear", "晴天"],
    ["wind", "大风"],
    ["rain", "下雨"],
    ["snow", "下雪"],
    ["drizzle", "雾雨"],
  ];

  const TIMES = [
    ["auto", "跟随时间"],
    ["dawn", "清晨"],
    ["noon", "正午"],
    ["dusk", "傍晚"],
    ["night", "深夜"],
    ["fast", "快进一夜"],
  ];

  const MOONS = [
    ["auto", "跟随日期"],
    ["crescent", "蛾眉月"],
    ["first", "上弦月"],
    ["full", "满月"],
    ["last", "下弦月"],
    ["waning", "残月"],
  ];

  const $ = (id) => document.getElementById(id);
  let place = null;
  let report = null;
  let demo = "auto";
  let tool = "brush";
  let color = COLORS[0];
  let flipped = false;
  let drawing = false;
  let lastPt = null;
  let wallpaperOn = false;
  const view = $("koi-view");
  const pattern = document.createElement("canvas");
  pattern.width = view.width;
  pattern.height = view.height;

  function weatherName(code) {
    const map = {
      0: "晴", 1: "多云", 2: "多云", 3: "阴", 45: "雾", 48: "雾",
      51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨", 56: "冻雨", 57: "冻雨",
      61: "小雨", 63: "中雨", 65: "大雨", 66: "冻雨", 67: "冻雨",
      71: "小雪", 73: "中雪", 75: "大雪", 77: "雪",
      80: "阵雨", 81: "阵雨", 82: "强阵雨", 85: "阵雪", 86: "阵雪",
      95: "雷雨", 96: "雷雨", 99: "雷雨",
    };
    return map[code] || "多云";
  }

  function weatherEffect(code) {
    if ([71, 73, 75, 77, 85, 86].indexOf(code) >= 0) return "snow";
    if ([51, 53, 55, 56, 57].indexOf(code) >= 0) return "drizzle";
    if ([45, 48].indexOf(code) >= 0) return "fog";
    if ([61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].indexOf(code) >= 0) return "rain";
    return "clear";
  }

  function cleanName(name) {
    return String(name || "").replace(/[<>]/g, "").trim().slice(0, 14);
  }

  function randomName() {
    return NAMES[Math.floor(Math.random() * NAMES.length)];
  }

  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
  }

  function openOverlay(id) {
    $(id).classList.remove("hidden");
    $("demo-menu").classList.add("hidden");
    $("menu").classList.add("hidden");
  }

  function closeOverlay(id) {
    $(id).classList.add("hidden");
  }

  function clockTick() {
    const tz = (place && place.tz) || "Asia/Shanghai";
    let parts;
    try {
      parts = {};
      new Intl.DateTimeFormat("zh-CN", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        weekday: "long",
        month: "numeric",
        day: "numeric",
      }).formatToParts(new Date()).forEach((p) => { parts[p.type] = p.value; });
    } catch (err) {
      parts = {};
      new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit", minute: "2-digit", hour12: false,
        weekday: "long", month: "numeric", day: "numeric",
      }).formatToParts(new Date()).forEach((p) => { parts[p.type] = p.value; });
    }
    const hh = String(parts.hour || "0").padStart(2, "0");
    const mm = String(parts.minute || "0").padStart(2, "0");
    $("clock").textContent = hh + ":" + mm;
    $("date-label").textContent = (parts.month || "") + "月" + (parts.day || "") + "日 " + (parts.weekday || "");
    $("tz-label").textContent = tz.indexOf("Shanghai") >= 0 ? "北京时间" : "当地时间";
    if (window.Pond && Pond.setClock) Pond.setClock(tz);
  }

  function renderDays() {
    const box = $("days");
    box.textContent = "";
    const daily = report && report.daily;
    if (!daily) return;
    ["今天", "明天", "后天"].forEach((label, i) => {
      const day = document.createElement("div");
      day.className = "day";
      const b = document.createElement("b");
      b.textContent = label;
      const em = document.createElement("em");
      em.textContent = weatherName(daily.weather_code[i]);
      const span = document.createElement("span");
      const lo = Math.round(daily.temperature_2m_min[i]);
      const hi = Math.round(daily.temperature_2m_max[i]);
      span.textContent = lo + " / " + hi + "°";
      day.appendChild(b);
      day.appendChild(em);
      day.appendChild(span);
      box.appendChild(day);
    });
  }

  function applyAtmosphere() {
    const code = report && report.current ? report.current.weather_code : 1;
    const wind = report && report.current ? report.current.wind_speed_10m : 0;
    let effect = demo === "auto" ? weatherEffect(code) : demo;
    if (demo === "auto" && effect === "clear" && wind >= 32) effect = "wind";
    if (effect === "fog") effect = "fog";
    Pond.setAtmosphere({ effect: effect === "fog" ? "fog" : effect, wind: demo === "wind" ? 40 : wind, tz: (place && place.tz) || "Asia/Shanghai" });
  }

  function renderWeather() {
    if (!report || !report.current) {
      $("now-label").textContent = "天气暂时不可用";
      return;
    }
    const temp = Math.round(report.current.temperature_2m);
    $("place-label").textContent = place ? place.name : "未知城市";
    $("now-label").textContent = weatherName(report.current.weather_code) + " · " + temp + "°C";
    const at = report.fetchedAt ? new Date(report.fetchedAt) : new Date();
    const hh = String(at.getHours()).padStart(2, "0");
    const mm = String(at.getMinutes()).padStart(2, "0");
    $("updated").textContent = hh + ":" + mm + " 更新 · 每半小时刷新";
    renderDays();
    applyAtmosphere();
    markChips();
  }

  async function loadWeather() {
    if (!place) return;
    $("now-label").textContent = "正在获取天气…";
    const url = "https://api.open-meteo.com/v1/forecast?latitude=" + place.lat +
      "&longitude=" + place.lon +
      "&current=temperature_2m,weather_code,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3";
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("status " + res.status);
      report = await res.json();
      report.fetchedAt = Date.now();
      if (report.timezone) place.tz = report.timezone;
      try { localStorage.setItem("bitan.weather", JSON.stringify({ place, report })); } catch (err) { /* ignore */ }
      renderWeather();
      clockTick();
    } catch (err) {
      $("now-label").textContent = "暂时连不上天气服务";
      if (report) renderDays();
    }
  }

  function savePlace() {
    try { localStorage.setItem("bitan.place", JSON.stringify(place)); } catch (err) { /* ignore */ }
  }

  async function usePlace(next) {
    place = {
      name: next.name,
      lat: Number(next.lat),
      lon: Number(next.lon),
      tz: next.tz || "Asia/Shanghai",
    };
    savePlace();
    $("place-label").textContent = place.name;
    $("use-geo").checked = false;
    markChips();
    closeOverlay("overlay-city");
    await loadWeather();
  }

  function markChips() {
    document.querySelectorAll("#city-chips button").forEach((btn) => {
      btn.classList.toggle("on", place && btn.dataset.name === place.name);
    });
  }

  async function searchCity() {
    const q = $("city-input").value.trim();
    const box = $("city-results");
    box.textContent = "";
    if (!q) return;
    const url = "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(q) + "&count=6&language=zh&format=json";
    try {
      const res = await fetch(url);
      const data = await res.json();
      const rows = data.results || [];
      if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "fine";
        empty.textContent = "没有找到这个城市";
        box.appendChild(empty);
        return;
      }
      rows.forEach((row) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const admin = row.admin1 ? " · " + row.admin1 : "";
        btn.textContent = row.name + admin;
        btn.addEventListener("click", () => usePlace({
          name: row.name,
          lat: row.latitude,
          lon: row.longitude,
          tz: row.timezone,
        }));
        box.appendChild(btn);
      });
    } catch (err) {
      const empty = document.createElement("div");
      empty.className = "fine";
      empty.textContent = "搜索失败，请稍后再试";
      box.appendChild(empty);
    }
  }

  async function useHere() {
    $("place-label").textContent = "正在定位…";
    $("use-geo").checked = true;
    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error("no geo")); return; }
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 6000, maximumAge: 600000 });
      });
      let name = "当前位置";
      try {
        const rev = await fetch("https://geocoding-api.open-meteo.com/v1/reverse?latitude=" + pos.coords.latitude + "&longitude=" + pos.coords.longitude + "&language=zh&format=json");
        if (rev.ok) {
          const data = await rev.json();
          if (data.results && data.results[0]) name = data.results[0].name;
        }
      } catch (err) { /* 没有逆地理也没关系 */ }
      await usePlace({ name, lat: pos.coords.latitude, lon: pos.coords.longitude });
      $("use-geo").checked = true;
      return;
    } catch (err) { /* 继续用网络位置 */ }
    try {
      const res = await fetch("https://ipwho.is/");
      const data = await res.json();
      if (!data.success) throw new Error("ip");
      let name = data.city || "当前位置";
      let lat = data.latitude;
      let lon = data.longitude;
      try {
        const found = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(name) + "&count=1&language=zh&format=json");
        const json = await found.json();
        if (json.results && json.results[0]) {
          name = json.results[0].name;
          lat = json.results[0].latitude;
          lon = json.results[0].longitude;
        }
      } catch (err) { /* 用原始坐标 */ }
      await usePlace({ name, lat, lon, tz: data.timezone && data.timezone.id });
      $("use-geo").checked = true;
    } catch (err) {
      $("use-geo").checked = false;
      toast("没有拿到位置，可以手动选一个城市");
      if (!place) await usePlace({ name: "杭州", lat: 30.2741, lon: 120.1551 });
    }
  }

  function renderRank() {
    const data = Pond.getRanking();
    const list = $("rank-list");
    list.textContent = "";
    data.list.forEach((fish, index) => {
      const li = document.createElement("li");
      const who = document.createElement("div");
      who.className = "who";
      const no = document.createElement("span");
      no.className = "no";
      no.textContent = String(index + 1).padStart(2, "0");
      const mini = document.createElement("i");
      mini.className = "mini";
      mini.style.background = fish.color;
      const text = document.createElement("div");
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = fish.name;
      const id = document.createElement("div");
      id.className = "id";
      id.textContent = "锦鲤 #" + String(fish.num).padStart(3, "0");
      text.appendChild(name);
      text.appendChild(id);
      who.appendChild(no);
      who.appendChild(mini);
      who.appendChild(text);
      const count = document.createElement("div");
      count.className = "count";
      count.textContent = fish.eaten + " 粒";
      li.appendChild(who);
      li.appendChild(count);
      list.appendChild(li);
    });
    $("rank-foot").textContent = data.guests + " 位小食客 · 共吃到 " + data.total + " 粒鱼粮";
  }

  function composite() {
    const g = view.getContext("2d");
    g.clearRect(0, 0, view.width, view.height);
    g.save();
    if (flipped) {
      g.translate(view.width, 0);
      g.scale(-1, 1);
    }
    Pond.drawKoiPreview(g, view, pattern);
    g.restore();
  }

  function syncSizeLabel() {
    const label = $("size-label");
    if (label) label.textContent = "鱼的大小 " + $("body-scale").value + "%";
  }

  function localPoint(ev) {
    const rect = view.getBoundingClientRect();
    let x = ((ev.clientX - rect.left) / rect.width) * view.width;
    const y = ((ev.clientY - rect.top) / rect.height) * view.height;
    if (flipped) x = view.width - x;
    return { x, y };
  }

  function paintTo(pt) {
    const g = pattern.getContext("2d");
    g.save();
    g.clip(Pond.koiClipPath(view.width, view.height));
    g.lineCap = "round";
    g.lineJoin = "round";
    g.lineWidth = Number($("brush-size").value);
    if (tool === "eraser") {
      g.globalCompositeOperation = "destination-out";
      g.strokeStyle = "rgba(0,0,0,1)";
      g.fillStyle = "rgba(0,0,0,1)";
    } else {
      g.globalCompositeOperation = "source-over";
      g.strokeStyle = color;
      g.fillStyle = color;
    }
    g.beginPath();
    if (Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y) < 0.8) {
      g.arc(pt.x, pt.y, Math.max(1, g.lineWidth / 2), 0, Math.PI * 2);
      g.fill();
    } else {
      g.moveTo(lastPt.x, lastPt.y);
      g.lineTo(pt.x, pt.y);
      g.stroke();
    }
    g.restore();
    lastPt = pt;
    composite();
  }

  function renderGallery() {
    const box = $("gallery");
    box.textContent = "";
    const rows = Pond.getCustoms();
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "还没有自己画的锦鲤。画一条，放进池塘吧。";
      box.appendChild(empty);
      return;
    }
    rows.forEach((fish) => {
      const card = document.createElement("div");
      card.className = "g-card";
      const img = document.createElement("img");
      img.alt = fish.name;
      img.src = fish.src;
      const name = document.createElement("div");
      name.className = "g-name";
      name.textContent = fish.name;
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "删除";
      del.addEventListener("click", () => {
        Pond.removeCustom(fish.num);
        renderGallery();
        toast(fish.name + " 游走了");
      });
      card.appendChild(img);
      card.appendChild(name);
      card.appendChild(del);
      box.appendChild(card);
    });
  }

  function release() {
    const name = cleanName($("koi-name").value) || randomName();
    composite();
    const fish = Pond.addCustom({
      name,
      scale: Number($("body-scale").value) / 100,
      src: Pond.exportPaint(pattern),
      v: 2,
    });
    if (!fish) {
      toast("这条鱼没有放进去");
      return;
    }
    pattern.getContext("2d").clearRect(0, 0, pattern.width, pattern.height);
    $("koi-name").value = "";
    $("body-scale").value = "100";
    syncSizeLabel();
    composite();
    renderGallery();
    toast(name + " 已经游进池塘");
  }

  function buildMenu(x, y) {
    const menu = $("menu");
    menu.textContent = "";
    const items = [
      ["在这里投喂", () => Pond.feed(x, y)],
      ["排行榜", () => { renderRank(); openOverlay("overlay-rank"); }],
      ["我的锦鲤", () => { renderGallery(); openOverlay("overlay-koi"); }],
      ["设置城市", () => openOverlay("overlay-city")],
      [wallpaperOn ? "退出全屏" : "全屏", toggleFull],
    ];
    items.forEach(([label, fn]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.classList.add("hidden");
        fn();
      });
      menu.appendChild(btn);
    });
    menu.style.left = Math.min(x, window.innerWidth - 180) + "px";
    menu.style.top = Math.min(y, window.innerHeight - 220) + "px";
    menu.classList.remove("hidden");
  }

  function toggleFull() {
    if (window.wallpaper) {
      window.wallpaper.toggle().then((state) => { wallpaperOn = !!(state && state.on); }).catch(() => {});
      return;
    }
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  function bootCities() {
    const box = $("city-chips");
    CITIES.forEach(([name, lat, lon]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = name;
      btn.dataset.name = name;
      btn.addEventListener("click", () => usePlace({ name, lat, lon }));
      box.appendChild(btn);
    });
  }

  function bootDemo() {
    const menu = $("demo-menu");
    const cap = document.createElement("div");
    cap.className = "cap";
    cap.textContent = "天气演示";
    menu.appendChild(cap);
    DEMO.forEach(([id, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.dataset.mode = id;
      if (id === "auto") btn.classList.add("on");
      btn.addEventListener("click", () => {
        demo = id;
        menu.querySelectorAll("button[data-mode]").forEach((el) => el.classList.toggle("on", el === btn));
        menu.classList.add("hidden");
        applyAtmosphere();
      });
      menu.appendChild(btn);
    });
    demoGroup(menu, "时间演示", TIMES, (id) => Pond.setTimeMode(id));
    demoGroup(menu, "月相演示", MOONS, (id) => Pond.setMoonMode(id));
  }

  function demoGroup(menu, title, items, apply) {
    const cap = document.createElement("div");
    cap.className = "cap";
    cap.textContent = title;
    menu.appendChild(cap);
    const grid = document.createElement("div");
    grid.className = "grid";
    const btns = [];
    items.forEach(([id, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      if (id === "auto") btn.classList.add("on");
      btn.addEventListener("click", () => {
        btns.forEach((el) => el.classList.toggle("on", el === btn));
        menu.classList.add("hidden");
        if (window.Pond) apply(id);
      });
      btns.push(btn);
      grid.appendChild(btn);
    });
    menu.appendChild(grid);
  }

  function bootSwatches() {
    const box = $("swatches");
    COLORS.forEach((hex, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.background = hex;
      btn.title = hex;
      if (index === 0) btn.classList.add("on");
      btn.addEventListener("click", () => {
        color = hex;
        tool = "brush";
        document.querySelectorAll(".tools button").forEach((el) => el.classList.toggle("on", el.dataset.tool === "brush"));
        box.querySelectorAll("button").forEach((el) => el.classList.toggle("on", el === btn));
      });
      box.appendChild(btn);
    });
  }

  function bind() {
    $("btn-city").addEventListener("click", () => openOverlay("overlay-city"));
    $("btn-rank").addEventListener("click", () => { renderRank(); openOverlay("overlay-rank"); });
    $("btn-koi").addEventListener("click", () => { renderGallery(); composite(); openOverlay("overlay-koi"); });
    $("btn-demo").addEventListener("click", (e) => {
      e.stopPropagation();
      $("demo-menu").classList.toggle("hidden");
    });
    $("city-search").addEventListener("click", searchCity);
    $("city-input").addEventListener("keydown", (e) => { if (e.key === "Enter") searchCity(); });
    $("use-geo").addEventListener("change", () => { if ($("use-geo").checked) useHere(); });
    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => closeOverlay(btn.dataset.close));
    });
    document.querySelectorAll(".overlay").forEach((overlay) => {
      overlay.addEventListener("pointerdown", (e) => {
        if (e.target === overlay) overlay.classList.add("hidden");
      });
    });
    $("btn-random-name").addEventListener("click", () => { $("koi-name").value = randomName(); });
    $("btn-release").addEventListener("click", release);
    $("btn-clear").addEventListener("click", () => {
      pattern.getContext("2d").clearRect(0, 0, pattern.width, pattern.height);
      composite();
    });
    $("btn-flip").addEventListener("click", () => { flipped = !flipped; composite(); });
    $("body-scale").addEventListener("input", syncSizeLabel);
    document.querySelectorAll(".tools button[data-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        tool = btn.dataset.tool;
        document.querySelectorAll(".tools button[data-tool]").forEach((el) => el.classList.toggle("on", el === btn));
      });
    });
    view.addEventListener("pointerdown", (e) => {
      drawing = true;
      view.setPointerCapture(e.pointerId);
      lastPt = localPoint(e);
      paintTo(lastPt);
    });
    view.addEventListener("pointermove", (e) => { if (drawing) paintTo(localPoint(e)); });
    view.addEventListener("pointerup", () => { drawing = false; });
    view.addEventListener("pointerleave", () => { drawing = false; });

    $("pond").addEventListener("contextmenu", (e) => {
      e.preventDefault();
      buildMenu(e.clientX, e.clientY);
    });
    document.addEventListener("pointerdown", (e) => {
      const menu = $("menu");
      if (!menu.classList.contains("hidden") && !menu.contains(e.target)) menu.classList.add("hidden");
      const demoMenu = $("demo-menu");
      if (!demoMenu.classList.contains("hidden") && !demoMenu.contains(e.target) && e.target !== $("btn-demo") && !$("btn-demo").contains(e.target)) {
        demoMenu.classList.add("hidden");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        document.querySelectorAll(".overlay").forEach((el) => el.classList.add("hidden"));
        $("menu").classList.add("hidden");
        $("demo-menu").classList.add("hidden");
      }
      if (e.key === "F11") {
        e.preventDefault();
        if (!window.wallpaper) toggleFull();
      }
    });
    setTimeout(() => $("hint").classList.add("fade"), 9000);
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem("bitan.place") || "null");
      if (saved && saved.name && saved.lat && saved.lon) place = saved;
      const cached = JSON.parse(localStorage.getItem("bitan.weather") || "null");
      if (cached && cached.report) report = cached.report;
    } catch (err) { /* ignore */ }
  }

  Pond.init($("pond"));
  Pond.onEat = () => {
    if (!$("overlay-rank").classList.contains("hidden")) renderRank();
  };
  Pond.onRoster = () => {
    if (!$("overlay-koi").classList.contains("hidden")) renderGallery();
  };
  bootCities();
  bootDemo();
  bootSwatches();
  bind();
  if (window.wallpaper) {
    window.wallpaper.state().then((state) => { wallpaperOn = !!(state && state.on); }).catch(() => {});
    window.wallpaper.onChange((on) => { wallpaperOn = !!on; });
  }
  syncSizeLabel();
  composite();
  restore();
  clockTick();
  setInterval(clockTick, 1000);
  if (place) {
    renderWeather();
    loadWeather();
  } else if (report) {
    renderWeather();
    useHere();
  } else {
    useHere();
  }
  setInterval(() => { if (place) loadWeather(); }, 30 * 60 * 1000);
})();
