"use strict";

const fs = require("node:fs");
const path = require("node:path");

const dayMs = 86400000;
const formatNumber = new Intl.NumberFormat("zh-CN");
const dateInChina = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });

function renderChart(history) {
  const latest = history.at(-1);
  const end = Date.parse(latest.date);
  const points = history
    .map(({ date, downloads }) => ({ time: Date.parse(date), downloads }))
    .filter(({ time }) => time >= end - 89 * dayMs);
  const start = points[0].time;
  const plot = { left: 86, right: 724, top: 115, bottom: 231 };
  const desiredStep = Math.max(1, Math.max(...points.map(({ downloads }) => downloads)) / 4);
  const magnitude = 10 ** Math.floor(Math.log10(desiredStep));
  const step = [1, 2, 5, 10].map((value) => value * magnitude).find((value) => value >= desiredStep);
  const x = (time) => end === start ? (plot.left + plot.right) / 2
    : plot.left + (time - start) / (end - start) * (plot.right - plot.left);
  const y = (downloads) => plot.bottom - downloads / (4 * step) * (plot.bottom - plot.top);
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = index * step;
    return `<path d="M${plot.left} ${y(value)}H${plot.right}" stroke="#295258"/>
      <text x="74" y="${y(value) + 4}" text-anchor="end">${formatNumber.format(value)}</text>`;
  }).join("\n    ");
  const intervals = Math.min(4, (end - start) / dayMs);
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => {
    const days = intervals ? Math.round((end - start) / dayMs * index / intervals) : 0;
    const time = start + days * dayMs;
    return `<text x="${x(time).toFixed(1)}" y="253" text-anchor="middle">${new Date(time).toISOString().slice(5, 10)}</text>`;
  }).join("\n    ");
  const line = points.map(({ time, downloads }) => `${x(time).toFixed(1)},${y(downloads).toFixed(1)}`).join(" ");
  const markerX = x(end).toFixed(1);
  const markerY = y(latest.downloads).toFixed(1);
  const total = formatNumber.format(latest.downloads);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="292" viewBox="0 0 760 292" role="img" aria-labelledby="title desc">
  <title id="title">塘里 Windows 安装包下载趋势</title>
  <desc id="desc">截至 ${latest.date}，GitHub 累计下载 ${total} 次。曲线使用最近 90 天内记录的实际采样点。</desc>
  <rect x="0.5" y="0.5" width="759" height="291" rx="17" fill="#102c31" stroke="#295258"/>
  <g font-family="system-ui, 'Microsoft YaHei', sans-serif">
    <text x="32" y="37" fill="#dcebe7" font-size="16" font-weight="600">Windows 安装包下载量</text>
    <text x="32" y="80" fill="#79e1bb" font-size="34" font-weight="700">${total}</text>
    <text x="728" y="36" text-anchor="end" fill="#c2d8d5" font-size="13">GitHub 累计下载</text>
    <text x="728" y="58" text-anchor="end" fill="#9dbcb9" font-size="12">截至 ${latest.date}</text>
    <g fill="#9dbcb9" font-size="12">
      ${grid}
      ${ticks}
    </g>
${points.length > 1 ? `    <polyline points="${line}" fill="none" stroke="#79e1bb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>\n` : ""}    <circle cx="${markerX}" cy="${markerY}" r="4.5" fill="#79e1bb" stroke="#102c31" stroke-width="2"/>
    <text x="32" y="274" fill="#9dbcb9" font-size="12">${points.length === 1 ? "已记录首个采样点" : "最近 90 天内的采样记录"}</text>
  </g>
</svg>
`;
}

const pages = JSON.parse(fs.readFileSync(0, "utf8"));
const installers = pages.flat().filter(({ draft, prerelease }) => !draft && !prerelease)
  .flatMap(({ tag_name, assets }) => assets.filter(({ name }) => name === `Tangli-${tag_name}-Setup.exe`));
if (!installers.length || installers.some(({ download_count }) => !Number.isSafeInteger(download_count) || download_count < 0)) {
  throw new Error("GitHub did not return valid Windows installer counts");
}

const output = process.argv[2] || path.join(__dirname, "../docs/downloads");
const historyPath = path.join(output, "history.json");
const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, "utf8")) : [];
const date = dateInChina.format(new Date());
const downloads = installers.reduce((sum, { download_count }) => sum + download_count, 0);
const previous = history.find((entry) => entry.date === date);
if (previous) previous.downloads = downloads;
else history.push({ date, downloads });
history.sort((a, b) => a.date.localeCompare(b.date));

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
fs.writeFileSync(path.join(output, "chart.svg"), renderChart(history));
console.log(`Recorded ${downloads} downloads across ${installers.length} installers on ${date}`);
