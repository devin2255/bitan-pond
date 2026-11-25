(() => {
  const api = window.tangliDock;
  const $ = (id) => document.getElementById(id);
  const inputs = ["layout", "edge", "displayId", "iconSize", "opacity", "magnify", "autohide", "followPond"];
  let state;
  let available = [];
  let categoriesDirty = false;
  let statuses = [];

  function status(text) {
    $("settings-status").textContent = text;
    $("settings-status").hidden = !text;
  }

  function renderDrives() {
    if (!state || categoriesDirty) return;
    const roots = new Map(available.map((drive) => [drive.root, drive.label]));
    for (const root of state.settings.indexRoots) if (!roots.has(root)) roots.set(root, "暂不可用");
    $("drives").replaceChildren(...[...roots].map(([root, name]) => {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = root;
      box.checked = state.settings.indexRoots.includes(root);
      box.onchange = () => { categoriesDirty = true; };
      const info = statuses.find((item) => item.root === root);
      const hint = info ? info.state === "ready" ? ` · ${info.count.toLocaleString()} 项` : info.state === "scanning" ? " · 扫描中" : " · 暂不可用" : "";
      label.append(box, ` ${root} ${name}${hint}`);
      return label;
    }));
    if (!roots.size) $("drives").textContent = "暂无可用本地盘符";
  }

  function render(value) {
    if (!value?.settings || (state && value.revision < state.revision)) return;
    state = value;
    const s = value.settings;
    $("enabled").checked = s.enabled;
    for (const option of document.querySelectorAll("button[data-material]")) {
      option.setAttribute("aria-pressed", String(option.dataset.material === s.material));
    }
    const automatic = new Option("主显示器", "");
    $("displayId").replaceChildren(automatic, ...value.displays.map((d) => new Option(d.name, d.id)));
    for (const key of inputs) {
      const input = $(key);
      if (input.type === "checkbox") input.checked = s[key];
      else input.value = s[key] == null ? "" : String(s[key]);
    }
    $("displayId").value ||= "";
    $("size-readout").textContent = s.iconSize + " px";
    $("opacity-readout").textContent = s.opacity + "%";
    $("opacity").disabled = s.material !== "frosted";
    for (const key of ["layout", "edge", "displayId", "iconSize"]) $(key).disabled = value.takeover;
    $("shortcut").textContent = value.shortcut ? "全局搜索 Ctrl+Alt+K" : "全局搜索快捷键被占用，可从 Dock 或托盘打开。";
    $("takeover-status").textContent = value.takeover
      ? "接管已启用。窗口最大化时，居中 Dock 会收起，鼠标移到停靠边缘即可唤出。按 Ctrl+Alt+Shift+T 可恢复原任务栏。"
      : value.displays.length > 1 ? "连接多个显示器时使用并存模式。"
      : "接管时隐藏 Windows 任务栏和桌面回收站。窗口可以最大化到屏幕边缘，居中 Dock 会自动收起。";
    $("takeover").textContent = value.takingOver ? "正在接管…" : value.takeover ? "恢复 Windows 任务栏" : "接管任务栏";
    $("takeover").disabled = value.takingOver || (!value.takeover && (!s.enabled || value.displays.length !== 1));
    renderDrives();
  }

  function update(promise, text) {
    return Promise.resolve(promise).then((value) => {
      render(value);
      if (text) status(text);
    }).catch((error) => {
      status(error.message);
      if (state) render(state);
    });
  }

  document.querySelectorAll("button[data-material]").forEach((button) => {
    button.onclick = () => update(api.save({ material: button.dataset.material }));
  });
  document.querySelectorAll("button[data-pick]").forEach((button) => {
    button.onclick = () => update(api.choose(button.dataset.pick));
  });
  for (const key of inputs) {
    const input = $(key);
    input.onchange = () => {
      const value = input.type === "checkbox" ? input.checked
        : input.type === "range" ? Number(input.value)
          : key === "displayId" ? input.value ? Number(input.value) : null : input.value;
      update(api.save({ [key]: value }));
    };
  }
  $("iconSize").oninput = () => { $("size-readout").textContent = $("iconSize").value + " px"; };
  $("opacity").oninput = () => { $("opacity-readout").textContent = $("opacity").value + "%"; };
  $("enabled").onchange = () => update(api.enabled($("enabled").checked));
  $("takeover").onclick = () => {
    if (!state) return;
    if (!state.takeover && !window.confirm("让塘里 Dock 接管任务栏？可随时在这里恢复，也可按 Ctrl+Alt+Shift+T。")) return;
    update(api.takeover(!state.takeover));
  };
  $("save-index").onclick = () => {
    const roots = [...$("drives").querySelectorAll("input:checked")].map((input) => input.value);
    categoriesDirty = false;
    update(api.setIndex(roots), "已应用搜索范围");
  };
  api.onSettings(render);
  api.onIndex((value) => { statuses = value; renderDrives(); });
  api.onError(status);
  update(api.state());
  api.drives().then((value) => { available = value; renderDrives(); }).catch((error) => status(error.message));
  api.indexStatus().then((value) => { statuses = value; renderDrives(); }).catch(() => {});
})();
