(() => {
  const api = window.tangliDock;
  const q = document.getElementById("query");
  const container = document.getElementById("results");
  const scope = document.getElementById("scope");
  const menu = document.getElementById("result-menu");
  const info = document.getElementById("search-status");
  let category = "all", rows = [], selected = 0, timer, revision = 0, sources = [], drives = [];

  function text(value) { info.textContent = value; }
  const help = () => text("用 D: 限定盘符，ext:pdf 限定扩展名");
  function setScope() {
    const local = drives.map((drive) => drive.root + (drive.state === "scanning" ? " 扫描中" : drive.state === "offline" ? " 暂不可用" : "")).join("、");
    const names = [...sources, ...(local ? ["塘里本地索引 " + local] : [])];
    scope.textContent = names.length ? names.join("　·　") : "本地搜索，可在右上角选择需要索引的盘符。";
  }

  function hideMenu() { menu.hidden = true; }

  function run(action, row) {
    hideMenu();
    if (!row) return;
    api.searchAction(action, row.id).then(() => {
      if (action === "pin") text("已固定到 Dock");
      if (action === "copy") text("已复制路径");
    }).catch((error) => text(error.message));
  }

  function showMenu(row, x, y) {
    if (!row) return;
    const actions = [["打开", "open"]];
    if (row.kind !== "app") actions.push(["打开所在位置", "reveal"], ["复制路径", "copy"]);
    actions.push(["固定到 Dock", "pin"]);
    menu.replaceChildren(...actions.map(([label, action]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.onclick = () => run(action, row);
      return button;
    }));
    menu.hidden = false;
    menu.style.left = Math.max(6, Math.min(x, innerWidth - menu.offsetWidth - 10)) + "px";
    menu.style.top = Math.max(6, Math.min(y, innerHeight - menu.offsetHeight - 10)) + "px";
  }

  function showSelection(scroll = false) {
    const buttons = [...container.querySelectorAll(".result")];
    for (let i = 0; i < buttons.length; i++) buttons[i].classList.toggle("selected", i === selected);
    if (scroll) buttons[selected]?.scrollIntoView({ block: "nearest" });
  }

  function render(value) {
    rows = value.rows;
    sources = value.sources;
    drives = value.drives;
    selected = 0;
    setScope();
    container.replaceChildren(...rows.map((row, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "result";
      const kind = document.createElement("span");
      kind.className = "result-kind";
      kind.textContent = { app: "应用", file: "文件", folder: "文件夹" }[row.kind];
      const line = document.createElement("span");
      line.className = "result-copy";
      const title = document.createElement("strong");
      title.textContent = row.name;
      const location = document.createElement("small");
      location.textContent = row.kind === "app" ? row.source : row.target;
      location.title = location.textContent;
      line.append(title, location);
      item.append(kind, line);
      item.onclick = () => run("open", row);
      item.onmouseenter = () => { selected = index; showSelection(); };
      item.oncontextmenu = (event) => { event.preventDefault(); showMenu(row, event.clientX, event.clientY); };
      return item;
    }));
    showSelection();
    if (!rows.length && q.value.trim()) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = drives.some((drive) => drive.state === "scanning")
        ? "当前没有匹配结果。盘符扫描完成后可重试。" : "当前搜索范围内没有匹配结果。";
      container.append(empty);
    }
    if (rows.length) text(`显示 ${rows.length} 项`);
    else help();
  }

  function searchNow() {
    hideMenu();
    clearTimeout(timer);
    const token = ++revision;
    if (!q.value.trim()) {
      render({ rows: [], sources, drives });
      return;
    }
    text("正在搜索…");
    const value = q.value;
    // Clear old results so Enter cannot open an item from a previous query.
    rows = [];
    container.replaceChildren();
    timer = setTimeout(async () => {
      try {
        const next = await api.query(value, category);
        if (token === revision) render(next);
      } catch (error) { if (token === revision) text(error.message); }
    }, 170);
  }

  q.addEventListener("input", searchNow);
  document.querySelectorAll("[data-kind]").forEach((button) => {
    button.onclick = () => {
      category = button.dataset.kind;
      document.querySelectorAll("[data-kind]").forEach((candidate) =>
        candidate.setAttribute("aria-pressed", String(candidate === button)));
      q.focus();
      searchNow();
    };
  });
  document.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (!menu.hidden) hideMenu();
      else api.hideSearch();
      return;
    }
    if (!menu.hidden) return;
    if (rows.length && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      selected = (selected + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
      showSelection(true);
    }
    if (event.key === "Enter" && document.activeElement === q) {
      event.preventDefault();
      run("open", rows[selected]);
    }
  });
  document.addEventListener("pointerdown", (event) => { if (!menu.contains(event.target)) hideMenu(); });
  document.getElementById("close").onclick = () => api.hideSearch();
  document.getElementById("configure").onclick = () => api.openSettings();
  api.onFocus(() => { q.focus(); q.select(); });
  api.onIndex((value) => { drives = value; setScope(); });
  api.onError(text);
  api.indexStatus().then((value) => { drives = value; setScope(); }).catch(() => {});
  q.focus();
})();
