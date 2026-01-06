// popup.js — UnAIfy popup UI + settings + GitHub blacklist import (MV3)

const FEATURES = [
  {
    key: "disable_sge",
    title: "Disable Google AI Overview",
    desc: "Disables Google's AI generated 'Overview' search result box"
  },
  {
    key: "filter_ai_domains",
    title: "Filter AI-heavy domains (Google results)",
    desc: "Hides results from domains in the imported GitHub blocklist"
  },
  {
    key: "use_uBlockOrigin_blacklist",
    title: "Use GitHub AI blocklist",
    desc: "Imports and applies the public no-AI hosts list (laylavish)"
  },
  {
    key: "warn_post_year",
    title: "Warning on post-2022 pages",
    desc: "Shows a warning if a page is created/updated after 2022"
  }
];

const DEFAULT_CUTOFF_YEAR = 2022;

// GitHub raw list (hosts format)
const GITHUB_HOSTS_URL =
  "https://raw.githubusercontent.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist/main/noai_hosts.txt";

// DOM helpers
const $ = (sel) => document.querySelector(sel);

let featuresEl, statusEl, resetBtn;

// Status helper
function setStatus(text, timeout = 1200) {
  if (!statusEl) return;
  statusEl.textContent = text;
  if (timeout) setTimeout(() => (statusEl.textContent = "Saved"), timeout);
}

// ---- Storage helpers ----
async function loadSettings() {
  const [{ unAIfySettings }, { unAIfyCutOffYear }] = await Promise.all([
    chrome.storage.sync.get("unAIfySettings"),
    chrome.storage.sync.get("unAIfyCutOffYear")
  ]);

  const { unAIfyGithubBlacklistFetchedAt, unAIfyGithubBlacklist } =
    await chrome.storage.local.get(["unAIfyGithubBlacklistFetchedAt", "unAIfyGithubBlacklist"]);

  // defaults: everything ON, but GitHub list may not be imported yet
  const defaultToggles = Object.fromEntries(FEATURES.map((f) => [f.key, true]));
  const mergedToggles = { ...defaultToggles, ...(unAIfySettings || {}) };

  return {
    toggles: mergedToggles,
    cutoffyear: Number.isInteger(unAIfyCutOffYear) ? unAIfyCutOffYear : DEFAULT_CUTOFF_YEAR,
    githubCount: Array.isArray(unAIfyGithubBlacklist) ? unAIfyGithubBlacklist.length : 0,
    githubFetchedAt: typeof unAIfyGithubBlacklistFetchedAt === "number" ? unAIfyGithubBlacklistFetchedAt : 0
  };
}

const saveToggles = (toggles) => chrome.storage.sync.set({ unAIfySettings: toggles });
const saveCutOffYear = (cutoffyear) => chrome.storage.sync.set({ unAIfyCutOffYear: cutoffyear });

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

    // basic sanity check
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

// ---- UI render ----
function render({ toggles, cutoffyear, githubCount, githubFetchedAt }) {
  featuresEl.innerHTML = "";

  // Toggles
  FEATURES.forEach((f) => {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "auto 1fr";
    row.style.gap = "10px";
    row.style.padding = "10px 0";
    row.style.borderBottom = "1px solid #1f2937";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!toggles[f.key];
    input.style.transform = "scale(1.1)";
    input.style.marginTop = "2px";

    const meta = document.createElement("div");
    meta.innerHTML = `
      <div style="font-weight:700">${f.title}</div>
      <div style="opacity:.85; font-size:12px; line-height:1.35">${f.desc}</div>
    `;

    input.addEventListener("change", async () => {
      const newToggles = { ...toggles, [f.key]: input.checked };
      await saveToggles(newToggles);
      toggles[f.key] = input.checked;
      setStatus("Saved");

      if (f.key === "disable_sge") {
        await syncGoogleSGE(newToggles);
      }

      // If they enable GitHub list but haven't imported yet, nudge them
      if (f.key === "use_uBlockOrigin_blacklist" && input.checked && githubCount === 0) {
        setStatus("Tip: click Refresh to import the GitHub list", 2500);
      }
    });

    row.appendChild(input);
    row.appendChild(meta);
    featuresEl.appendChild(row);
  });

  // GitHub list panel (replaces old editable blacklist)
  const panel = document.createElement("div");
  panel.style.marginTop = "12px";
  panel.style.padding = "12px";
  panel.style.border = "1px solid #1f2937";
  panel.style.borderRadius = "12px";
  panel.style.background = "#0b1220";
  panel.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
      <div>
        <div style="font-weight:800">GitHub AI blocklist</div>
        <div style="opacity:.85; font-size:12px; margin-top:2px;">
          Domains imported: <b>${githubCount}</b> · Last fetched: <b>${fmtTime(githubFetchedAt)}</b>
        </div>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="gh-refresh" class="btn" type="button">Refresh</button>
        <button id="gh-clear" class="btn" type="button" style="opacity:.9">Clear</button>
      </div>
    </div>
    <div style="opacity:.8; font-size:12px; margin-top:8px; line-height:1.35">
      Source: laylavish “noai_hosts.txt”. Your Google-result filtering will only work when
      <b>Filter AI-heavy domains</b> and <b>Use GitHub AI blocklist</b> are enabled.
    </div>
  `;
  featuresEl.appendChild(panel);

  // Bind GitHub panel buttons
  const refreshBtn = $("#gh-refresh");
  const clearBtn = $("#gh-clear");

  refreshBtn.addEventListener("click", async () => {
    try {
      setStatus("Downloading list…", 0);
      const domains = await fetchGithubBlacklistDomains();
      await chrome.storage.local.set({
        unAIfyGithubBlacklist: domains,
        unAIfyGithubBlacklistFetchedAt: Date.now()
      });
      setStatus(`Imported ${domains.length} domains`, 2500);

      // Re-render to show updated counts
      render({
        toggles,
        cutoffyear,
        githubCount: domains.length,
        githubFetchedAt: Date.now()
      });
    } catch (e) {
      console.error(e);
      setStatus("Failed to import list", 2500);
    }
  });

  clearBtn.addEventListener("click", async () => {
    await chrome.storage.local.set({
      unAIfyGithubBlacklist: [],
      unAIfyGithubBlacklistFetchedAt: 0
    });
    setStatus("Cleared imported list", 2000);
    render({
      toggles,
      cutoffyear,
      githubCount: 0,
      githubFetchedAt: 0
    });
  });

  // Cutoff year panel (for your warning feature)
  const yearPanel = document.createElement("div");
  yearPanel.style.marginTop = "12px";
  yearPanel.style.padding = "12px";
  yearPanel.style.border = "1px solid #1f2937";
  yearPanel.style.borderRadius = "12px";
  yearPanel.style.background = "#0b1220";
  yearPanel.innerHTML = `
    <div style="font-weight:800">Warning cutoff year</div>
    <div style="opacity:.85; font-size:12px; margin-top:2px;">Warn on pages updated after this year.</div>
    <div style="display:flex; gap:8px; margin-top:10px;">
      <input id="cutoff-year" type="number" min="1990" max="2100"
        style="width:120px; padding:8px; border-radius:10px; border:1px solid #1f2937; background:#0f172a; color:#fff;"
        value="${cutoffyear}" />
      <button id="cutoff-save" class="btn" type="button">Save</button>
    </div>
  `;
  featuresEl.appendChild(yearPanel);

  $("#cutoff-save").addEventListener("click", async () => {
    const v = parseInt($("#cutoff-year").value, 10);
    if (!Number.isInteger(v) || v < 1990 || v > 2100) {
      setStatus("Invalid year", 1500);
      return;
    }
    await saveCutOffYear(v);
    setStatus("Saved");
  });
}

// ---- Existing function (kept) ----
async function syncGoogleSGE(toggles) {
  // your existing code expects these ruleset IDs
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

// ---- Init ----
async function init() {
  featuresEl = $("#features");
  statusEl = $("#status");
  resetBtn = $("#reset");

  const data = await loadSettings();
  render(data);

  resetBtn.addEventListener("click", async () => {
    const defaultToggles = Object.fromEntries(FEATURES.map((f) => [f.key, true]));
    await Promise.all([
      saveToggles(defaultToggles),
      saveCutOffYear(DEFAULT_CUTOFF_YEAR),
      chrome.storage.local.set({
        unAIfyGithubBlacklist: [],
        unAIfyGithubBlacklistFetchedAt: 0
      })
    ]);
    await syncGoogleSGE(defaultToggles);

    render({
      toggles: defaultToggles,
      cutoffyear: DEFAULT_CUTOFF_YEAR,
      githubCount: 0,
      githubFetchedAt: 0
    });
    setStatus("Reset to defaults", 2000);
  });

  setStatus("Ready", 800);
}

// Ensure popup.js runs after DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}