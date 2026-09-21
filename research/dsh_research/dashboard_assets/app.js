const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pill(status) {
  const raw = String(status ?? "unknown");
  const s = raw.toLowerCase();
  const cls = ["current","clean","pass","active","ready","ok","success"].includes(s)
    ? "ok"
    : ["stale","dirty","warn","warning","not-ready"].includes(s)
      ? "warn"
      : ["missing","invalid","error","fail","failed"].includes(s)
        ? "bad"
        : "neutral";
  return '<span class="pill ' + cls + '">' + esc(raw) + "</span>";
}

function metric(label, value, sub = "") {
  return '<article class="metric"><div class="label">' + esc(label) +
    '</div><div class="value">' + esc(value) + '</div>' +
    (sub ? '<div class="sub">' + esc(sub) + '</div>' : "") + "</article>";
}

function row(label, value) {
  return '<div class="row"><span>' + esc(label) + '</span><strong>' + esc(value) + "</strong></div>";
}

async function api(path) {
  const response = await fetch(path, {headers: {"Accept": "application/json"}, cache: "no-store"});
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || "HTTP " + response.status);
  }
  return payload;
}

function showBanner(message) {
  $("banner").textContent = message;
  $("banner").classList.remove("hidden");
}

function hideBanner() {
  $("banner").classList.add("hidden");
}

function showDetail(title, payload) {
  $("detail-title").textContent = title;
  $("detail-json").textContent = JSON.stringify(payload, null, 2);
  $("detail-dialog").showModal();
}

function renderStatus(payload) {
  const s = payload.data || {};
  const p = s.project || {};
  $("project-title").textContent = p.title || p.slug || "Research Project";
  $("project-meta").textContent = [
    p.template ? "template " + p.template : "",
    p.config_schema ? "schema " + p.config_schema : "",
    p.research_pack ? "pack " + p.research_pack : ""
  ].filter(Boolean).join(" · ");

  const data = s.data || {};
  const pipeline = s.pipeline || {};
  const results = s.results || {};
  const runs = s.runs || {};
  const paper = s.paper || {};

  $("overview-cards").innerHTML = [
    metric("Datasets", data.registered_datasets ?? 0, (data.current ?? 0) + " current"),
    metric("Pipeline", pipeline.steps ?? 0, (pipeline.stale ?? 0) + " stale"),
    metric("Runs", runs.total ?? 0, (runs.failed ?? 0) + " failed"),
    metric("Results", results.registered ?? 0, (results.current ?? 0) + " current"),
    metric("Paper", paper.pdf_exists ? "PDF" : (paper.html_exists ? "HTML" : "Draft"), paper.source || "")
  ].join("");

  const git = s.git || {};
  $("git-pill").outerHTML = pill(git.available ? (git.dirty ? "dirty" : "clean") : "unavailable")
    .replace("<span", '<span id="git-pill"');
  $("repo-summary").innerHTML = [
    row("Branch", git.branch || "—"),
    row("Commit", git.commit ? String(git.commit).slice(0,12) : "—"),
    row("Dirty", git.dirty ? "yes" : "no")
  ].join("");

  const d = s.design || {};
  const econ = d.economics || {};
  const detailItems = [
    ["Field", d.field || "—"],
    ["Question", d.question_defined ? "Defined" : "Missing"],
    ["Hypotheses", d.hypotheses ?? 0],
    ["Population", econ.population === undefined ? "—" : (econ.population ? "Defined" : "Missing")],
    ["Unit of observation", econ.unit_of_observation === undefined ? "—" : (econ.unit_of_observation ? "Defined" : "Missing")],
    ["Outcome", econ.outcome === undefined ? "—" : (econ.outcome ? "Defined" : "Missing")],
    ["Estimand", econ.estimand === undefined ? "—" : (econ.estimand ? "Defined" : "Missing")],
    ["Identification", econ.identification_strategy === undefined ? "—" : (econ.identification_strategy ? "Defined" : "Missing")]
  ];
  $("design-grid").innerHTML = detailItems.map(([label,value]) =>
    '<div class="detail"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + "</div></div>"
  ).join("");

  const lit = s.literature || {};
  $("literature-cards").innerHTML = [
    metric("Sources", lit.sources ?? 0),
    metric("Bibliography", lit.bibliography_entries ?? 0),
    metric("Evidence rows", lit.evidence_rows ?? 0),
    metric("Notes", lit.notes ?? 0)
  ].join("");

  $("paper-grid").innerHTML = [
    metric("Source", paper.source_exists ? "Present" : "Missing", paper.source || ""),
    metric("Bibliography", paper.bibliography_exists ? "Present" : "Missing"),
    metric("PDF", paper.pdf_exists ? "Rendered" : "Not rendered"),
    metric("HTML", paper.html_exists ? "Rendered" : "Not rendered")
  ].join("");

  const release = s.release || {};
  $("release-summary").innerHTML = [
    row("Status", release.status || "not-ready"),
    row("Release directory", release.directory_exists ? "present" : "missing"),
    row("Release engine", release.implemented ? "implemented" : "planned")
  ].join("");
}

function renderCheck(payload) {
  const report = payload.data || {};
  const summary = report.summary || {};
  const ok = Boolean(payload.ok);
  $("check-pill").outerHTML = pill(ok ? "pass" : "fail").replace("<span", '<span id="check-pill"');
  $("check-summary").innerHTML = [
    row("Mode", report.mode || "full"),
    row("Errors", summary.errors ?? 0),
    row("Warnings", summary.warnings ?? 0),
    row("Passed", summary.passed ?? 0)
  ].join("");

  $("global-status").outerHTML = pill(ok ? "healthy" : "attention")
    .replace("neutral", ok ? "ok" : "warn")
    .replace("<span", '<span id="global-status"');
}

function renderData(payload) {
  const items = payload?.data?.datasets || [];
  $("data-count").textContent = items.length + " registered";
  $("data-empty").classList.toggle("hidden", items.length !== 0);
  $("data-table").innerHTML = items.map(item =>
    '<tr data-detail="dataset" data-id="' + esc(item.dataset_id) + '">' +
      "<td><strong>" + esc(item.dataset_id) + "</strong></td>" +
      "<td>" + pill(item.status) + "</td>" +
      "<td class=\"mono\">" + esc(item.path || "—") + "</td>" +
      '<td><span class="hash mono" title="' + esc(item.current_sha256 || "") + '">' +
        esc(item.current_sha256 ? item.current_sha256.slice(0,16) + "…" : "—") +
      "</span></td></tr>"
  ).join("");
}

function renderPipeline(payload) {
  const items = payload?.data?.steps || [];
  $("pipeline-count").textContent = items.length + " steps";
  $("pipeline-empty").classList.toggle("hidden", items.length !== 0);
  $("pipeline-table").innerHTML = items.map(item =>
    '<tr data-detail="pipeline" data-id="' + esc(item.step) + '">' +
      "<td><strong>" + esc(item.step) + "</strong></td>" +
      "<td>" + pill(item.status) + "</td>" +
      '<td><span class="hash mono" title="' + esc(item.signature || "") + '">' +
        esc(item.signature ? item.signature.slice(0,14) + "…" : "—") + "</span></td>" +
      "<td class=\"mono\">" + esc(item.latest_run || "—") + "</td>" +
      "<td>" + esc((item.reasons || [])[0] || "—") + "</td></tr>"
  ).join("");
}

function renderResults(payload) {
  const items = payload?.data?.results || [];
  $("result-count").textContent = items.length + " registered";
  $("results-empty").classList.toggle("hidden", items.length !== 0);
  $("results-table").innerHTML = items.map(item =>
    '<tr data-detail="result" data-id="' + esc(item.result_id) + '">' +
      "<td><strong>" + esc(item.result_id) + "</strong></td>" +
      "<td>" + esc(item.result_type || "—") + "</td>" +
      "<td>" + pill(item.status) + "</td>" +
      "<td>" + esc(item.artifacts ?? 0) + "</td>" +
      "<td class=\"mono\">" + esc(item.run || "—") + "</td></tr>"
  ).join("");
}

async function refreshAll() {
  hideBanner();
  $("refresh-btn").disabled = true;
  $("refresh-btn").textContent = "Refreshing…";
  try {
    const [status, check, data, pipeline, results] = await Promise.all([
      api("/api/status"),
      api("/api/check?mode=full"),
      api("/api/data"),
      api("/api/pipeline"),
      api("/api/results")
    ]);
    renderStatus(status);
    renderCheck(check);
    renderData(data);
    renderPipeline(pipeline);
    renderResults(results);
    $("last-updated").textContent = "Updated " + new Date().toLocaleTimeString();
  } catch (error) {
    showBanner(error instanceof Error ? error.message : String(error));
  } finally {
    $("refresh-btn").disabled = false;
    $("refresh-btn").textContent = "Refresh";
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("tr[data-detail]");
  if (!target) return;
  const kind = target.dataset.detail;
  const id = target.dataset.id;
  try {
    let path = "";
    if (kind === "dataset") path = "/api/dataset?id=" + encodeURIComponent(id);
    if (kind === "pipeline") path = "/api/pipeline-step?step=" + encodeURIComponent(id);
    if (kind === "result") path = "/api/result?id=" + encodeURIComponent(id);
    if (!path) return;
    showDetail(id, await api(path));
  } catch (error) {
    showBanner(error instanceof Error ? error.message : String(error));
  }
});

$("refresh-btn").addEventListener("click", refreshAll);
$("detail-close").addEventListener("click", () => $("detail-dialog").close());
$("release-check-btn").addEventListener("click", async () => {
  $("release-check-btn").disabled = true;
  try {
    const payload = await api("/api/check?mode=release");
    showDetail("Release check", payload);
  } catch (error) {
    showBanner(error instanceof Error ? error.message : String(error));
  } finally {
    $("release-check-btn").disabled = false;
  }
});

const navLinks = [...document.querySelectorAll("nav a")];
const sections = navLinks
  .map(link => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);
const observer = new IntersectionObserver((entries) => {
  const visible = entries
    .filter(entry => entry.isIntersecting)
    .sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  navLinks.forEach(link => {
    link.classList.toggle("active", link.getAttribute("href") === "#" + visible.target.id);
  });
}, {rootMargin: "-15% 0px -70% 0px", threshold: [0, .2, .5]});
sections.forEach(section => observer.observe(section));

refreshAll();
