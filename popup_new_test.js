// popup.js — UnAIfy popup UI + settings + editable blocklist/allowlist + GitHub import (MV3)

const FEATURES = [
  {
    key: "disable_sge",
    title: "Disable Google AI Overview",
    desc: "Disables Google's AI-generated 'Overview' box"
  },
  {
    key: "filter_ai_domains",
    title: "Filter AI-heavy domains (Google results)",
    desc: "Hides results that match your blocklists"
  },
  {
    key: "use_uBlockOrigin_blacklist",
    title: "Use GitHub AI blocklist",
    desc: "Also hide domains from the public no‑AI hosts list"
  },
  {
    key: "warn_post_year",
    title: "Warning on post-2022 pages",
    desc: "Shows a warning if a page is created/updated after 2022"
  }
];

const DEFAULT_CUTOFF_YEAR = 2022;

// Upstream list (hosts format)
const GITHUB_HOSTS_URL =
  "https://raw.githubusercontent.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist/main/noai_hosts.txt";

const $ = (sel) => document.querySelector(sel);

let featuresEl, statusEl, resetBtn;

function setStatus(text, timeout = 1400) {
  if (!statusEl) return;
  statusEl.textContent = text;
  if (timeout) setTimeout(() => (statusEl.textContent = "Ready"), timeout);
}

function normalizeDomain(line) {
  if (!line) return null;
  let s = String(line).trim().toLowerCase();
  if (!s) return null;

  // remove inline comments
  s = s.replace(/\s+#.*$/, "").replace(/\s+\/\/.*$/, "").trim();

  // strip protocol / www / paths
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];

  if (!/[a-z0-9-]+\.[a-z0-9.-]+$/.test(s)) return null;
  return s;
}

function parseTextareaDomains(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const d = normalizeDomain(raw);
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

// ---- Storage helpers ----
async function loadAll() {
  const sync = await chrome.storage.sync.get([
    "unAIfySettings",
    "unAIfyBlacklist",     // user blocklist additions
    "unAIfyAllowlist",     // user allowlist overrides
    "unAIfyCutOffYear"
  ]);

  const local = await chrome.storage.local.get([
    "unAIfyGithubBlacklist",
    "unAIfyGithubBlacklistFetchedAt"
  ]);

  const defaultToggles = Object.fromEntries(FEATURES.map((f) => [f.key, true]));
  // sensible default: GitHub list toggle ON, but list may not yet be imported
  defaultToggles.use_uBlockOrigin_blacklist = true;

  const toggles = { ...defaultToggles, ...(sync.unAIfySettings || {}) };

  return {
    toggles,
    cutoffyear: Number.isInteger(sync.unAIfyCutOffYear) ? sync.unAIfyCutOffYear : DEFAULT_CUTOFF_YEAR,
    blocklist: Array.isArray(sync.unAIfyBlacklist) ? sync.unAIfyBlacklist : [],
    allowlist: Array.isArray(sync.unAIfyAllowlist) ? sync.unAIfyAllowlist : [],
    githubCount: Array.isArray(local.unAIfyGithubBlacklist) ? local.unAIfyGithubBlacklist.length : 0,
    githubFetchedAt: typeof local.unAIfyGithubBlacklistFetchedAt === "number" ? local.unAIfyGithubBlacklistFetchedAt : 0
  };
}

const saveToggles = (toggles) => chrome.storage.sync.set({ unAIfySettings: toggles });
const saveBlocklist = (arr) => chrome.storage.sync.set({ unAIfyBlacklist: arr });
const saveAllowlist = (arr) => chrome.storage.sync.set({ unAIfyAllowlist: arr });
const saveCutOffYear = (y) => chrome.storage.sync.set({ unAIfyCutOffYear: y });

// ---- GitHub list parsing + fetch ----
function parseHostsFileToDomains(text) {
  const out = new Set();

  for (let line of String(text || "").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    // strip inline comments
    line = line.split("#")[0].trim();
    if (!line) continue;

    const parts = line.split(/\s+/).filter(Boolean);

    // hosts lines usually: "0.0.0.0 www.domain.tld"
    // sometimes just: "domain.tld"
    const candidate = parts.length === 1 ? parts[0] : parts[parts.length - 1];
    if (!candidate) continue;

    let host = candidate.toLowerCase().replace(/^www\./, "");

    if (!/[a-z0-9-]+\.[a-z0-9.-]+$/.test(host)) continue;

    out.add(host);
  }

  return Array.from(out);
}

async function fetchGithubBlacklistDomains() {
  const res = await fetch(GITHUB_HOSTS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  const txt = await res.text();
  return parseHostsFileToDomains(txt);
}

function fmtTime(ms) {
  if (!ms) return "Never";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "Unknown";
  }
}

// ---- UI bits ----
function makeSwitch(checked) {
  const label = document.createElement("label");
  label.className = "switch";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!checked;

  const slider = document.createElement("span");
  slider.className = "slider";

  label.appendChild(input);
  label.appendChild(slider);
  return { label, input };
}

async function syncGoogleSGE(toggles) {
  const enable = !!toggles.disable_sge;
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enable ? ["google-ai-overview-off-redirect"] : [],
      disableRulesetIds: enable ? [] : ["google-ai-overview-off-redirect"]
    });
  } catch (e) {
    console.warn("syncGoogleSGE failed", e);
  }
}

async function render(data) {
  const { toggles, cutoffyear, blocklist, allowlist, githubCount, githubFetchedAt } = data;

  // --- Features (toggles right) ---
  featuresEl.innerHTML = "";
  FEATURES.forEach((f) => {
    const row = document.createElement("div");
    row.className = "feature-row";

    const meta = document.createElement("div");
    meta.className = "feature-meta";
    meta.innerHTML = `
      <div class="feature-title">${f.title}</div>
      <div class="feature-sub">${f.desc}</div>
    `;

    const sw = makeSwitch(!!toggles[f.key]);

    sw.input.addEventListener("change", async () => {
      const next = { ...toggles, [f.key]: sw.input.checked };
      await saveToggles(next);
      toggles[f.key] = sw.input.checked;
      setStatus("Saved");

      if (f.key === "disable_sge") await syncGoogleSGE(next);
    });

    row.appendChild(meta);
    row.appendChild(sw.label);
    featuresEl.appendChild(row);
  });

  // --- Textareas ---
  $("#blocklist").value = (blocklist || []).join("\n");
  $("#allowlist").value = (allowlist || []).join("\n");

  $("#blocklist-count").textContent = `Custom blocklist: ${(blocklist || []).length} domains`;
  $("#allowlist-count").textContent = `Allowlist: ${(allowlist || []).length} domains`;
  $("#github-info").textContent = `GitHub list: ${githubCount} · fetched: ${fmtTime(githubFetchedAt)}`;

  // --- Blocklist save ---
  $("#blocklist-save").onclick = async () => {
    const parsed = parseTextareaDomains($("#blocklist").value);
    await saveBlocklist(parsed);
    $("#blocklist-count").textContent = `Custom blocklist: ${parsed.length} domains`;
    setStatus("Blocklist saved", 1600);
  };

  // --- Allowlist save ---
  $("#allowlist-save").onclick = async () => {
    const parsed = parseTextareaDomains($("#allowlist").value);
    await saveAllowlist(parsed);
    $("#allowlist-count").textContent = `Allowlist: ${parsed.length} domains`;
    setStatus("Allowlist saved", 1600);
  };

  // --- GitHub refresh/clear ---
  $("#gh-refresh").onclick = async () => {
    try {
      setStatus("Downloading list…", 0);
      const domains = await fetchGithubBlacklistDomains();
      await chrome.storage.local.set({
        unAIfyGithubBlacklist: domains,
        unAIfyGithubBlacklistFetchedAt: Date.now()
      });
      $("#github-info").textContent = `GitHub list: ${domains.length} · fetched: ${fmtTime(Date.now())}`;
      setStatus(`Imported ${domains.length} domains`, 2000);
    } catch (e) {
      console.error(e);
      setStatus("Failed to import list", 2200);
    }
  };

  $("#gh-clear").onclick = async () => {
    await chrome.storage.local.set({
      unAIfyGithubBlacklist: [],
      unAIfyGithubBlacklistFetchedAt: 0
    });
    $("#github-info").textContent = `GitHub list: 0 · fetched: Never`;
    setStatus("Cleared GitHub list", 1800);
  };

  // --- Cutoff year ---
  $("#cutoff-year").value = cutoffyear;
  $("#cutoff-save").onclick = async () => {
    const v = parseInt($("#cutoff-year").value, 10);
    if (!Number.isInteger(v) || v < 1990 || v > 2100) {
      setStatus("Invalid year", 1500);
      return;
    }
    await saveCutOffYear(v);
    setStatus("Saved", 1200);
  };

  // --- Reset ---
  resetBtn.onclick = async () => {
    const defaultToggles = Object.fromEntries(FEATURES.map((f) => [f.key, true]));
    defaultToggles.use_uBlockOrigin_blacklist = true;

    await Promise.all([
      saveToggles(defaultToggles),
      saveBlocklist([]),
      saveAllowlist([]),
      saveCutOffYear(DEFAULT_CUTOFF_YEAR),
      chrome.storage.local.set({ unAIfyGithubBlacklist: [], unAIfyGithubBlacklistFetchedAt: 0 })
    ]);

    await syncGoogleSGE(defaultToggles);

    setStatus("Reset", 1400);
    const fresh = await loadAll();
    render(fresh);
  };
}

// ---- Init ----
async function init() {
  featuresEl = $("#features");
  statusEl = $("#status");
  resetBtn = $("#reset");

  const data = await loadAll();
  await render(data);

  setStatus("Ready", 900);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}