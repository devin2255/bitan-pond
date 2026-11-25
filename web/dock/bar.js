(() => {
  const api = window.tangliDock;
  const bar = document.getElementById("bar");
  const items = document.getElementById("items");
  const message = document.getElementById("bar-status");
  const tiles = new Map();
  const divider = document.createElement("div");
  divider.className = "bar-divider";
  divider.setAttribute("role", "separator");
  let state, pending, dragging, scheduled, timer;
  let statusText = "";

  function status(text) {
    statusText = String(text);
    message.textContent = statusText;
    message.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { message.hidden = true; statusText = ""; reportShape(); }, 4500);
    reportShape();
  }

  function action(promise) {
    return Promise.resolve(promise).catch((error) => status(error.message));
  }

  function reportShape() {
    if (scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      if (!state) return;
      const viewport = items.getBoundingClientRect();
      const rects = [...bar.querySelectorAll(".tile")].map((button) => {
        const r = button.getBoundingClientRect();
        const clipped = items.contains(button);
        const left = clipped ? Math.max(r.left, viewport.left) : r.left;
        const top = clipped ? Math.max(r.top, viewport.top) : r.top;
        const right = clipped ? Math.min(r.right, viewport.right) : r.right;
        const bottom = clipped ? Math.min(r.bottom, viewport.bottom) : r.bottom;
        return { x: left, y: top, width: right - left, height: bottom - top };
      });
      if (statusText && !message.hidden) {
        const r = message.getBoundingClientRect();
        rects.push({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
      api.shape(rects.filter((rect) => rect.width > 0 && rect.height > 0)).catch(() => {});
    });
  }

  function tile(item) {
    if (tiles.has(item.id)) return tiles.get(item.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tile item";
    button.dataset.id = item.id;
    const image = new Image();
    image.alt = "";
    image.draggable = false;
    const fallback = document.createElement("span");
    fallback.className = "app-letter";
    const count = document.createElement("span");
    count.className = "window-count";
    count.setAttribute("aria-hidden", "true");
    button.append(image, fallback, count);
    button.addEventListener("click", () => {
      const r = button.getBoundingClientRect();
      action(api.item(item.id, r.x + r.width / 2, r.y + r.height / 2));
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      action(api.context(item.id));
    });
    button.addEventListener("dragstart", (event) => {
      dragging = item.id;
      event.dataTransfer.setData("application/x-tangli-dock-item", item.id);
      event.dataTransfer.effectAllowed = "move";
    });
    button.addEventListener("dragend", () => {
      dragging = null;
      if (pending) { const next = pending; pending = null; render(next); }
    });
    const view = { button, image, fallback, count };
    tiles.set(item.id, view);
    return view;
  }

  function updateTile(item) {
    const { button, image, fallback, count } = tile(item);
    button.dataset.active = String(item.active);
    button.dataset.running = String(item.count > 0);
    button.draggable = item.pin;
    const title = item.name + (item.count > 1 ? `，${item.count} 个窗口` : "");
    button.title = title;
    button.setAttribute("aria-label", title);
    if (item.icon && image.src !== item.icon) image.src = item.icon;
    image.hidden = !item.icon;
    fallback.hidden = !!item.icon;
    fallback.textContent = [...item.name][0] || "·";
    count.hidden = item.count <= 1;
    count.textContent = item.count;
    return button;
  }

  function render(value) {
    if (dragging) { pending = value; return; }
    state = value;
    bar.dataset.material = value.material;
    bar.dataset.classic = String(value.classicAcrylic);
    bar.dataset.backdrop = value.backdrop;
    bar.dataset.full = String(value.full);
    bar.dataset.edge = value.edge;
    bar.dataset.magnify = String(value.magnify);
    bar.dataset.scene = value.pondColor ? value.night ? "night" : "day" : "neutral";
    bar.style.setProperty("--tile-size", (value.iconSize + 8) + "px");
    bar.style.setProperty("--glass-opacity", value.opacity / 100);
    const { scrollLeft, scrollTop } = items;
    const content = value.items.map(updateTile);
    if (value.items.length && value.running.length) content.push(divider);
    content.push(...value.running.map(updateTile));
    const keep = new Set(content);
    for (const [id, view] of tiles) {
      if (keep.has(view.button)) continue;
      view.button.remove();
      tiles.delete(id);
    }
    if (!keep.has(divider)) divider.remove();
    for (const [index, node] of content.entries()) {
      if (items.children[index] !== node) items.insertBefore(node, items.children[index] || null);
    }
    items.scrollLeft = scrollLeft;
    items.scrollTop = scrollTop;
    reportShape();
  }

  bar.addEventListener("dragover", (event) => {
    if (event.dataTransfer.types.includes("Files") || dragging) event.preventDefault();
  });
  bar.addEventListener("drop", (event) => {
    event.preventDefault();
    const pin = event.dataTransfer.getData("application/x-tangli-dock-item");
    if (pin) action(api.reorder(pin, event.target.closest(".tile")?.dataset.id || ""));
    else if (event.dataTransfer.files.length) action(api.drop([...event.dataTransfer.files]));
  });
  items.addEventListener("wheel", (event) => {
    if (!state || state.vertical || items.scrollWidth <= items.clientWidth) return;
    event.preventDefault();
    items.scrollLeft += event.deltaY || event.deltaX;
  }, { passive: false });
  items.addEventListener("scroll", reportShape);
  bar.addEventListener("contextmenu", (event) => {
    if (!event.target.closest(".item")) { event.preventDefault(); action(api.command("system")); }
  });
  document.getElementById("start").onclick = () => action(api.command("start"));
  document.getElementById("search").onclick = () => action(api.command("search"));
  document.getElementById("system").onclick = () => action(api.command("system"));
  const add = document.getElementById("add");
  add.onclick = () => action(api.choose("file"));
  add.oncontextmenu = (event) => { event.preventDefault(); event.stopPropagation(); action(api.choose("folder")); };
  window.addEventListener("resize", reportShape);
  api.onError(status);
  api.onBar(render);
})();
