(() => {
  const $ = (id) => document.getElementById(id);
  const prefix = "bitan.journal.";
  const taskPrefix = prefix + "task.";
  const duration = 25 * 60 * 1000;
  function today() {
    const now = new Date();
    return [now.getFullYear(), now.getMonth() + 1, now.getDate()].join("-");
  }
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function addTask(value) {
    const input = $("task-input");
    const text = (value ?? input.value).trim().slice(0, 120);
    if (!text) { input.focus(); return false; }
    const key = taskPrefix + today() + "." + crypto.randomUUID();
    write(key, { text, done: false, created: Date.now() });
    input.value = "";
    return true;
  }
  const card = $("journal");
  if (!card) {
    $("task-form").onsubmit = (event) => { event.preventDefault(); window.journalEditor.submit($("task-input").value); };
    document.onkeydown = (event) => { if (event.key === "Escape") window.close(); };
    return;
  }
  let day, timer;
  function renderTasks() {
    day = today();
    const entries = [];
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(taskPrefix + day + ".")) continue;
      const task = read(key);
      if (typeof task?.text === "string") entries.push({ key, task });
    }
    entries.sort((a, b) => a.task.created - b.task.created);
    $("task-list").replaceChildren(...entries.map(({key, task}) => {
      const row = document.createElement("li");
      const label = document.createElement("label");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = task.done === true;
      check.onchange = () => {
        const latest = read(key);
        if (latest) write(key, { ...latest, done: check.checked });
        renderTasks();
      };
      const name = document.createElement("span");
      name.textContent = task.text;
      label.append(check, name);
      const remove = document.createElement("button");
      remove.type = "button"; remove.textContent = "×";
      remove.setAttribute("aria-label", "删除事项：" + task.text);
      remove.onclick = () => { localStorage.removeItem(key); renderTasks(); };
      row.append(label, remove);
      return row;
    }));
    $("task-empty").hidden = entries.length !== 0;
  }
  function renderView() {
    const expanded = read(prefix + "expanded") === true;
    card.hidden = read(prefix + "hidden") === true;
    card.dataset.view = expanded ? "expanded" : "compact";
    $("journal-detail").hidden = !expanded;
    $("journal-toggle").setAttribute("aria-expanded", String(expanded));
    $("journal-toggle").setAttribute("aria-label", expanded ? "收起池畔小记" : "展开池畔小记");
    $("journal-toggle").title = expanded ? "收起" : "展开池畔小记";
    if (!expanded || card.hidden) {
      $("demo-menu").classList.add("hidden");
      $("task-form").hidden = true;
    }
    if (expanded && !card.hidden) renderTasks();
  }
  function toggleVisible() { write(prefix + "hidden", !card.hidden); renderView(); }
  function remaining() {
    return Math.max(0, Math.min(duration, timer?.end ? timer.end - Date.now() : timer?.remaining || 0));
  }
  function tick() {
    if (day !== today()) renderTasks();
    const left = Math.ceil(remaining() / 1000);
    const active = timer?.end && left > 0, paused = !timer?.end && left > 0;
    const time = String(Math.floor(left / 60)).padStart(2, "0") + ":" + String(left % 60).padStart(2, "0");
    const value = active ? "专注中 · " + time : paused ? "已暂停 · " + time : timer ? "专注已完成" : "计时未开始";
    if ($("timer-status").textContent !== value) $("timer-status").textContent = value;
    const action = active ? "暂停" : paused ? "继续" : "开始 25 分钟";
    if ($("timer-toggle").textContent !== action) $("timer-toggle").textContent = action;
    $("timer-reset").hidden = !timer;
  }
  $("timer-toggle").onclick = () => {
    timer = read(prefix + "timer");
    const left = remaining();
    timer = timer?.end && left > 0 ? { remaining: left } : { end: Date.now() + (left || duration) };
    write(prefix + "timer", timer); tick();
  };
  $("timer-reset").onclick = () => { timer = null; localStorage.removeItem(prefix + "timer"); tick(); };
  $("journal-toggle").onclick = () => { write(prefix + "expanded", card.dataset.view !== "expanded"); renderView(); };
  $("journal-hide").onclick = toggleVisible;
  $("task-add").onclick = () => {
    if (document.body.classList.contains("wallpaper-mode") && window.desktopTools) {
      window.desktopTools.editTask().then((text) => { if (text && addTask(text)) renderTasks(); });
      return;
    }
    $("task-form").hidden = false; $("task-input").focus();
  };
  $("task-form").onsubmit = (event) => {
    event.preventDefault();
    if (addTask()) { $("task-form").hidden = true; renderTasks(); $("task-add").focus(); }
  };
  window.addEventListener("storage", ({key}) => {
    if (key === null || key === prefix + "timer") { timer = read(prefix + "timer"); tick(); }
    if (key === null || key === prefix + "expanded" || key === prefix + "hidden") renderView();
    if (key === null || key.startsWith(taskPrefix)) renderTasks();
  });
  window.pondJournal = { tick, hidden: () => card.hidden, toggleVisible };
  timer = read(prefix + "timer");
  renderView(); tick();
})();
