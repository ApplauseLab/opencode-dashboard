const palette = ["#8bd3ff", "#b8f06a", "#f7c66a", "#c59cff", "#ff9db1", "#74e0c3", "#f39762", "#7fa7ff"];
const fmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const fullFmt = new Intl.NumberFormat();
const moneyFmt = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

let state = null;

const $ = (id) => document.getElementById(id);

function costLabel(value, known = true) {
  return known ? moneyFmt.format(value) : "N/A";
}

function tokenTotal(row) {
  return row.input + row.output + row.reasoning + row.cacheRead + row.cacheWrite;
}

function selectedRows() {
  const projectId = $("projectFilter").value;
  return projectId === "all" ? state.rows : state.rows.filter((row) => row.projectId === projectId);
}

function selectedDaily() {
  const rows = selectedRows();
  const byDay = new Map();
  for (const row of rows) {
    const day = byDay.get(row.day) ?? { day: row.day, total: 0, cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, sessions: 0 };
    day.total += row.total;
    day.cost += row.cost ?? 0;
    day.costKnown ||= row.costKnown;
    day.input += row.input;
    day.output += row.output;
    day.reasoning += row.reasoning;
    day.cacheRead += row.cacheRead;
    day.cacheWrite += row.cacheWrite;
    day.sessions += row.sessions;
    byDay.set(row.day, day);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function renderStats() {
  const rows = selectedRows();
  const daily = selectedDaily();
  const totals = rows.reduce((acc, row) => {
    acc.tokens += row.total;
    acc.cost += row.cost ?? 0;
    acc.costKnown ||= row.costKnown;
    acc.sessions += row.sessions;
    acc.projects.add(row.projectId);
    return acc;
  }, { tokens: 0, cost: 0, costKnown: false, sessions: 0, projects: new Set() });
  const activeDays = daily.filter((day) => day.total > 0).length;
  $("stats").innerHTML = [
    ["Total tokens", fullFmt.format(totals.tokens)],
    ["Known cost", costLabel(totals.cost, totals.costKnown)],
    ["Active projects", fullFmt.format(totals.projects.size)],
    ["Sessions", fullFmt.format(totals.sessions)],
    ["Avg known daily cost", costLabel(activeDays ? totals.cost / activeDays : 0, totals.costKnown)],
  ].map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function chartScales(items, width, height, padding, maxValue) {
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const x = (index) => padding.left + (items.length <= 1 ? innerWidth / 2 : (index / (items.length - 1)) * innerWidth);
  const y = (value) => padding.top + innerHeight - (maxValue ? value / maxValue : 0) * innerHeight;
  return { x, y, innerWidth, innerHeight };
}

function axis(days, maxValue, width, height, padding) {
  const { x, y } = chartScales(days, width, height, padding, maxValue);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxValue * ratio);
  const dayTicks = days.filter((_, index) => days.length < 8 || index % Math.ceil(days.length / 6) === 0);
  return `
    ${ticks.map((tick) => `<line class="grid-line" x1="${padding.left}" x2="${width - padding.right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${padding.left - 8}" y="${y(tick) + 4}" text-anchor="end">${fmt.format(tick)}</text>`).join("")}
    ${dayTicks.map((day) => `<text class="axis" x="${x(days.indexOf(day))}" y="${height - 12}" text-anchor="middle">${day.slice(5)}</text>`).join("")}
  `;
}

function costAxis(days, maxValue, width, height, padding) {
  const { x, y } = chartScales(days, width, height, padding, maxValue);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxValue * ratio);
  const dayTicks = days.filter((_, index) => days.length < 8 || index % Math.ceil(days.length / 6) === 0);
  return `
    ${ticks.map((tick) => `<line class="grid-line" x1="${padding.left}" x2="${width - padding.right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${padding.left - 8}" y="${y(tick) + 4}" text-anchor="end">${moneyFmt.format(tick)}</text>`).join("")}
    ${dayTicks.map((day) => `<text class="axis" x="${x(days.indexOf(day))}" y="${height - 12}" text-anchor="middle">${day.slice(5)}</text>`).join("")}
  `;
}

function linePath(points, days, maxValue, width, height, padding) {
  const { x, y } = chartScales(days, width, height, padding, maxValue);
  return points.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
}

function renderProjectChart() {
  const rows = selectedRows();
  const days = [...new Set(rows.map((row) => row.day))].sort();
  const projects = [...new Map(rows.map((row) => [row.projectId, row.projectName])).entries()]
    .map(([id, name]) => ({ id, name, total: rows.filter((row) => row.projectId === id).reduce((sum, row) => sum + row.total, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  const series = projects.map((project) => ({
    ...project,
    values: days.map((day) => rows.find((row) => row.day === day && row.projectId === project.id)?.total ?? 0),
  }));
  const maxValue = Math.max(1, ...series.flatMap((item) => item.values));
  const width = 960;
  const height = 340;
  const padding = { top: 18, right: 18, bottom: 38, left: 58 };

  $("projectChart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Token usage over time per project">
      ${axis(days, maxValue, width, height, padding)}
      ${series.map((item, index) => `<path class="line" d="${linePath(item.values, days, maxValue, width, height, padding)}" stroke="${palette[index % palette.length]}"></path>`).join("")}
    </svg>
    <div class="legend">${series.map((item, index) => `<span><i style="background:${palette[index % palette.length]}"></i>${item.name}</span>`).join("")}</div>
  `;
}

function renderDailyChart() {
  const daily = selectedDaily();
  const width = 960;
  const height = 340;
  const padding = { top: 18, right: 18, bottom: 38, left: 58 };
  const maxValue = Math.max(1, ...daily.map((day) => day.total));
  const { x, y, innerWidth } = chartScales(daily.map((day) => day.day), width, height, padding, maxValue);
  const barWidth = Math.max(3, Math.min(28, innerWidth / Math.max(1, daily.length) - 3));
  const parts = [
    ["cacheRead", "Cache read", "#455a7a"],
    ["cacheWrite", "Cache write", "#5b6f93"],
    ["input", "Input", "#8bd3ff"],
    ["output", "Output", "#b8f06a"],
    ["reasoning", "Reasoning", "#f7c66a"],
  ];

  const bars = daily.map((day, index) => {
    let cursor = 0;
    return parts.map(([key,, color]) => {
      const value = day[key];
      const y1 = y(cursor + value);
      const y0 = y(cursor);
      cursor += value;
      return `<rect class="bar" x="${x(index) - barWidth / 2}" y="${y1}" width="${barWidth}" height="${Math.max(0, y0 - y1)}" fill="${color}"><title>${day.day}: ${fullFmt.format(value)} ${key}</title></rect>`;
    }).join("");
  }).join("");

  $("dailyChart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily token usage">
      ${axis(daily.map((day) => day.day), maxValue, width, height, padding)}
      ${bars}
    </svg>
    <div class="legend">${parts.map(([, label, color]) => `<span><i style="background:${color}"></i>${label}</span>`).join("")}</div>
  `;
}

function renderCostChart() {
  const daily = selectedDaily();
  const width = 960;
  const height = 340;
  const padding = { top: 18, right: 18, bottom: 38, left: 58 };
  const maxValue = Math.max(1, ...daily.map((day) => day.cost));
  const { x, y, innerWidth } = chartScales(daily.map((day) => day.day), width, height, padding, maxValue);
  const barWidth = Math.max(3, Math.min(28, innerWidth / Math.max(1, daily.length) - 3));
  const bars = daily.map((day, index) => {
    const y1 = y(day.cost);
    const y0 = y(0);
    return `<rect class="bar" x="${x(index) - barWidth / 2}" y="${y1}" width="${barWidth}" height="${Math.max(0, y0 - y1)}" fill="#c59cff"><title>${day.day}: ${moneyFmt.format(day.cost)}</title></rect>`;
  }).join("");

  $("costChart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Known daily cost">
      ${costAxis(daily.map((day) => day.day), maxValue, width, height, padding)}
      ${bars}
    </svg>
    <div class="legend"><span><i style="background:#c59cff"></i>Known USD</span></div>
  `;
}

function renderProjectList() {
  const rows = selectedRows();
  const projects = new Map();
  for (const row of rows) {
    const project = projects.get(row.projectId) ?? { name: row.projectName, total: 0, cost: 0, costKnown: false, sessions: 0 };
    project.total += row.total;
    project.cost += row.cost ?? 0;
    project.costKnown ||= row.costKnown;
    project.sessions += row.sessions;
    projects.set(row.projectId, project);
  }
  const ranked = [...projects.values()].sort((a, b) => b.total - a.total).slice(0, 12);
  const max = Math.max(1, ...ranked.map((project) => project.total));
  $("projectList").innerHTML = ranked.map((project) => `
    <div class="project-row">
      <header><strong>${project.name}</strong><small>${costLabel(project.cost, project.costKnown)} · ${fmt.format(project.total)} tokens · ${fullFmt.format(project.sessions)} sessions</small></header>
      <div class="bar-track"><div class="bar-fill" style="width:${(project.total / max) * 100}%"></div></div>
    </div>
  `).join("");
}

function renderProviderList() {
  const providers = new Map();
  for (const row of selectedRows()) {
    const id = row.model.providerID;
    const provider = providers.get(id) ?? { name: id === "unknown" ? "Unknown provider" : id, total: 0, cost: 0, costKnown: false, sessions: 0 };
    provider.total += row.total;
    provider.cost += row.cost ?? 0;
    provider.costKnown ||= row.costKnown;
    provider.sessions += row.sessions;
    providers.set(id, provider);
  }
  const ranked = [...providers.values()].sort((a, b) => b.cost - a.cost).slice(0, 12);
  const max = Math.max(1, ...ranked.map((provider) => provider.cost));
  $("providerList").innerHTML = ranked.map((provider) => `
    <div class="project-row">
      <header><strong>${provider.name}</strong><small>${costLabel(provider.cost, provider.costKnown)} · ${fmt.format(provider.total)} tokens</small></header>
      <div class="bar-track"><div class="bar-fill" style="width:${(provider.cost / max) * 100}%"></div></div>
    </div>
  `).join("");
}

function renderModelList() {
  const models = new Map();
  for (const row of selectedRows()) {
    const id = `${row.model.providerID}:${row.model.id}${row.model.variant ? `:${row.model.variant}` : ""}`;
    const model = models.get(id) ?? { name: row.pricing.label + (row.model.variant ? ` (${row.model.variant})` : ""), source: row.pricing.source, total: 0, cost: 0, costKnown: false, sessions: 0 };
    model.total += row.total;
    model.cost += row.cost ?? 0;
    model.costKnown ||= row.costKnown;
    model.sessions += row.sessions;
    models.set(id, model);
  }
  const ranked = [...models.values()].sort((a, b) => b.cost - a.cost).slice(0, 16);
  const max = Math.max(1, ...ranked.map((model) => model.cost));
  $("modelList").innerHTML = ranked.map((model) => `
    <div class="project-row">
      <header><strong>${model.name}</strong><small>${costLabel(model.cost, model.costKnown)} · ${fmt.format(model.total)} tokens · ${model.source}</small></header>
      <div class="bar-track"><div class="bar-fill" style="width:${(model.cost / max) * 100}%"></div></div>
    </div>
  `).join("");
}

function renderDailyTable() {
  $("dailyTable").innerHTML = selectedDaily().slice().reverse().map((day) => `
    <tr>
      <td>${day.day}</td>
      <td>${fullFmt.format(day.total)}</td>
      <td>${costLabel(day.cost, day.costKnown)}</td>
      <td>${fullFmt.format(day.input)}</td>
      <td>${fullFmt.format(day.output)}</td>
      <td>${fullFmt.format(day.reasoning)}</td>
      <td>${fullFmt.format(day.cacheRead + day.cacheWrite)}</td>
    </tr>
  `).join("");
}

function render() {
  renderStats();
  renderProjectChart();
  renderDailyChart();
  renderCostChart();
  renderProjectList();
  renderProviderList();
  renderModelList();
  renderDailyTable();
}

async function load() {
  const res = await fetch("/api/usage");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to load usage data");
  state = data;
  $("source").textContent = `Reading ${data.dbPath} · Updated ${new Date(data.generatedAt).toLocaleString()}`;
  $("pricingNote").textContent = data.pricingNote;
  const filter = $("projectFilter");
  filter.innerHTML = `<option value="all">All projects</option>` + data.projects.map((project) => `<option value="${project.id}">${project.name}</option>`).join("");
  filter.addEventListener("change", render);
  render();
}

load().catch((error) => {
  $("stats").innerHTML = `<div class="stat error"><span>Load failed</span><strong>${error.message}</strong></div>`;
});
