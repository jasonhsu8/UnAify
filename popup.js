// popup.js — UnAIfy

const FEATURES = [
  {
    key: "disable_sge",
    title: "Disable Google AI Overview",
    desc: "Disables Google's AI-generated 'Overview' search result box"
  },
  {
    key: "filter_ai_domains",
    title: "Filter AI-heavy domains",
    desc: "Hide results using uBlockOrigin's AI blocklist + your edits (Allowlist overrides)"
  },
  {
    key: "warn_post_year",
    title: "Warning on post cut off year pages",
    desc: "Shows a warning if a page is created/updated after cut off year (default 2022)"
  }
];

const DEFAULT_CUTOFF_YEAR = 2022;

// uBlockOrigin GitHub raw list (hosts format)
const GITHUB_HOSTS_URL =
  "https://raw.githubusercontent.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist/main/noai_hosts.txt";

// uBlockOrigin GitHub
const GITHUB_UBLOCKORIGIN_URL = "https://github.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist";

// Storage keys
const KEY_SETTINGS = "unAIfySettings";
const KEY_BLOCKLIST = "unAIfyBlacklist";     // user-added blocklist (editable)
const KEY_ALLOWLIST = "unAIfyAllowlist";     // user allowlist override (editable)
const KEY_CUTOFF = "unAIfyCutOffYear";

const KEY_GH_LIST = "unAIfyGithubBlacklist"; // local storage (big list)
const KEY_GH_FETCHED = "unAIfyGithubBlacklistFetchedAt";

const $ = (sel) => document.querySelector(sel);

let featuresEl, statusEl, resetBtn;

// Status helper
function setStatus(text, timeout = 1200) {
  if (!statusEl) return;
  statusEl.textContent = text;
  if (timeout) setTimeout(() => (statusEl.textContent = "Ready"), timeout);
}

// UI helpers
function makeSwitch(id, checked) {
  const wrap = document.createElement("label");
  wrap.className = "switch";
  wrap.title = "Toggle";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = !!checked;

  const slider = document.createElement("span");
  slider.className = "slider";

  wrap.appendChild(input);
  wrap.appendChild(slider);

  return { wrap, input };
}

function fmtTime(ms) {
  if (!ms) return "Never";
  try {
    return new Date(ms).toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }); 
  } catch {
    return "Unknown"; 
  }
}

// Storage helpers
async function loadState() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get([KEY_SETTINGS, KEY_BLOCKLIST, KEY_ALLOWLIST, KEY_CUTOFF]),
    chrome.storage.local.get([KEY_GH_LIST, KEY_GH_FETCHED])
  ]);

  const defaultToggles = Object.fromEntries(FEATURES.map(f => [f.key, false]));
  // Default: uBlockOrigin list toggle OFF (user can turn ON in the domain controls panel)
  defaultToggles.use_uBlockOrigin_blacklist = false;

  const toggles = { ...defaultToggles, ...(sync[KEY_SETTINGS] || {}) };

  return {
    toggles,
    blocklist: Array.isArray(sync[KEY_BLOCKLIST]) ? sync[KEY_BLOCKLIST] : [],
    allowlist: Array.isArray(sync[KEY_ALLOWLIST]) ? sync[KEY_ALLOWLIST] : [],
    cutoffyear: Number.isInteger(sync[KEY_CUTOFF]) ? sync[KEY_CUTOFF] : DEFAULT_CUTOFF_YEAR,
    ghCount: Array.isArray(local[KEY_GH_LIST]) ? local[KEY_GH_LIST].length : 0,
    ghFetchedAt: typeof local[KEY_GH_FETCHED] === "number" ? local[KEY_GH_FETCHED] : 0
  };
}

const saveToggles = (toggles) => chrome.storage.sync.set({ [KEY_SETTINGS]: toggles });
const saveBlocklist = (arr) => chrome.storage.sync.set({ [KEY_BLOCKLIST]: arr });
const saveAllowlist = (arr) => chrome.storage.sync.set({ [KEY_ALLOWLIST]: arr });
const saveCutOffYear = (y) => chrome.storage.sync.set({ [KEY_CUTOFF]: y });

// DNR ruleset toggling
async function syncGoogleSGE(toggles) {
  const on = !!toggles.disable_sge;
  if (!chrome.declarativeNetRequest?.updateEnabledRulesets) return;
  if (on) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: ["google-ai-overview-off-redirect"],
      disableRulesetIds: []
    });
  } else {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: [],
      disableRulesetIds: ["google-ai-overview-off-redirect"]
    });
  }
}

// Domain utils 
function normalizeDomain(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;

  // remove inline comments
  s = s.replace(/\s+#.*$/, "").replace(/\s+\/\/.*$/, "").trim();

  // strip protocol / www / paths
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];

  if (!/[a-z0-9-]+\.[a-z0-9-.]+$/.test(s)) return null;
  return s;
}

function parseDomainTextarea(text) {
  const lines = (text || "").split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const dom = normalizeDomain(line);
    if (dom && !seen.has(dom)) { seen.add(dom); out.push(dom); }
  }
  return out;
}

function listToTextarea(list) {
  return (list || []).join("\n");
}

// uBlockOrigin list fetch
function parseHostsFileToDomains(text) {
  const out = new Set();
  for (let line of String(text || "").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    line = line.split("#")[0].trim();
    if (!line) continue;

    const parts = line.split(/\s+/).filter(Boolean);
    const candidate = parts.length === 1 ? parts[0] : parts[parts.length - 1];
    if (!candidate) continue;

    let host = candidate.toLowerCase().replace(/^www\./, "");
    if (!/[a-z0-9-]+\.[a-z0-9.-]+$/.test(host)) continue;

    out.add(host);
  }
  return Array.from(out);
}

async function fetchGithubList() {
  const res = await fetch(GITHUB_HOSTS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  const txt = await res.text();
  return parseHostsFileToDomains(txt);
}

// Render
function render({ toggles, blocklist, allowlist, cutoffyear, ghCount, ghFetchedAt }) {
  featuresEl.innerHTML = "";

  FEATURES.forEach((f) => {
    const row = document.createElement("div");
    row.className = "toggle";

    const label = document.createElement("label");
    label.htmlFor = f.key;

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = f.title;

    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = f.desc;

    label.appendChild(title);
    label.appendChild(desc);

    const sw = makeSwitch(f.key, !!toggles[f.key]);

    sw.input.addEventListener("change", async () => {
      const newToggles = { ...toggles, [f.key]: sw.input.checked };
      await saveToggles(newToggles);
      toggles[f.key] = sw.input.checked;
      setStatus("Saved");

      if (f.key === "disable_sge") {
        await syncGoogleSGE(newToggles);
      }
    });

    row.appendChild(label);
    row.appendChild(sw.wrap);
    featuresEl.appendChild(row);

    // AI Domain Controls Panel (under filter_ai_domains)
    if (f.key === "filter_ai_domains") {
      const editorWrap = document.createElement("div");
      editorWrap.style.margin = "6px 0 2px";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "AI domain controls";
      editBtn.className = "btn";
      editorWrap.appendChild(editBtn);

      const panel = document.createElement("div");
      panel.className = "panel";
      panel.style.display = "none";
      panel.innerHTML = `
        <div class="row" style="margin-bottom:10px;">
          <div style="min-width:0">
            <div class="title">GitHub AI blocklist</div>
            <div class="small">
              <b>Source:</b> <span class="mono"> <i>laylavish/uBlockOrigin-HUGE-AI-Blocklist</i> </span> <br><b>File:</b> <span class="mono"><i>noai_hosts.txt</i></span>
            </div>
          </div>
          <span class="chip mono" id="gh-chip">uBlockOrigin's blocklist: ${ghCount} · ${fmtTime(ghFetchedAt)}</span>
        </div>

        <div class="row" style="margin-bottom:10px;">
          <div style="min-width:0">
            <div class="title" style="font-size:13px;">Use uBlockOrigin's AI blocklist</div>
            <div class="small">When enabled, uBlockOrigin's AI blocklist domains are included in filtering.</div>
            <div class="small" style="margin-top:6px;">Press <b><i>Refresh</i></b> to download/update the list.</div>
          </div>
          <span id="gh-toggle-slot"></span>
        </div>

        <div class="row" style="margin-bottom:12px;">
          <button id="gh-refresh" class="btn success" type="button">Refresh AI Blocklist</button>
          <button id="gh-clear" class="btn danger" type="button">Clear uBlockOrigin blocklist</button>
          <a class="link" href="${GITHUB_UBLOCKORIGIN_URL}" target="_blank" rel="noreferrer noopener">View source</a>
        </div>

        <details id="allow-details">
          <summary>
            <div class="summary-left">
              <div class="summary-title">Allowlist</div>
              <div class="summary-sub">Keeps domains visible even if uBlockOrigin blocks them.</div>
            </div>
            <span class="chip mono" id="allow-chip">Allowlist: ${allowlist.length}</span>
          </summary>
          <div class="details-body">
            <textarea id="allow-ta" placeholder="example.com&#10;openai.com"></textarea>
            <div class="actions">
              <button id="allow-cancel" class="btn" type="button">Cancel</button>
              <button id="allow-save" class="btn" type="button">Save allowlist</button>
            </div>
          </div>
        </details>

        <details id="block-details">
          <summary>
            <div class="summary-left">
              <div class="summary-title">Custom blocklist</div>
              <div class="summary-sub">Extra domains you want to hide.</div>
            </div>
            <span class="chip mono" id="block-chip">Custom blocklist: ${blocklist.length}</span>
          </summary>
          <div class="details-body">
            <textarea id="block-ta" placeholder="perplexity.ai&#10;gemini.google.com"></textarea>
            <div class="actions">
              <button id="block-cancel" class="btn" type="button">Cancel</button>
              <button id="block-save" class="btn" type="button">Save blocklist</button>
            </div>
          </div>
        </details>

        <div class="small" style="margin-top:10px;">
          <b>Tip:</b>
            <i>Click on <b>Allowlist</b> to customise! Allowlist overrides blocklist. You can also click on <b>Custom blocklist</b> to add extra domains!</i>
        </div>
      `;

      editorWrap.appendChild(panel);
      featuresEl.appendChild(editorWrap);
      editorWrap.style.marginBottom = "6px";

      // bind panel show/hide
      function populate() {
        const allowEl = panel.querySelector("#allow-ta");
        const blockEl = panel.querySelector("#block-ta");
        if (!allowEl || !blockEl) {
          console.warn("[UnAIfy] AI domain controls panel is missing textarea elements. Check panel HTML.");
          return;
        }
        allowEl.value = listToTextarea(allowlist);
        blockEl.value = listToTextarea(blocklist);
        panel.querySelector("#allow-chip").textContent = `Allowlist: ${allowlist.length}`;
        panel.querySelector("#block-chip").textContent = `Custom blocklist: ${blocklist.length}`;
        const ghChip = panel.querySelector("#gh-chip");
        if (ghChip) ghChip.textContent = `uBlockOrigin's blocklist: ${ghCount} · ${fmtTime(ghFetchedAt)}`;
      }

      editBtn.addEventListener("click", () => {
        const showing = panel.style.display !== "none";
        if (showing) panel.style.display = "none";
        else {
          populate();
          panel.style.display = "block";
        }
      });

      // uBlockOrigin toggle switch (stored in unAIfySettings)
      const ghToggleSlot = panel.querySelector("#gh-toggle-slot");
      const ghSwitch = makeSwitch("use_uBlockOrigin_blacklist", !!toggles.use_uBlockOrigin_blacklist);
      ghToggleSlot.appendChild(ghSwitch.wrap);

      ghSwitch.input.addEventListener("change", async () => {
        const newToggles = { ...toggles, use_uBlockOrigin_blacklist: ghSwitch.input.checked };
        await saveToggles(newToggles);
        toggles.use_uBlockOrigin_blacklist = ghSwitch.input.checked;
        setStatus("Saved");

        if (ghSwitch.input.checked && ghCount === 0) {
          setStatus("Tip: refresh the uBlockOrigin blocklist", 1800);
        }
      });

      // Refresh uBlockOrigin's blocklist
      panel.querySelector("#gh-refresh").addEventListener("click", async () => {
        try {
          setStatus("Downloading list…", 0);
          const domains = await fetchGithubList();
          const now = Date.now();
          await chrome.storage.local.set({
            [KEY_GH_LIST]: domains,
            [KEY_GH_FETCHED]: now
          });
          ghCount = domains.length;
          ghFetchedAt = now;
          const ghChip = panel.querySelector("#gh-chip");
          if (ghChip) ghChip.textContent = `uBlockOrigin's blocklist: ${ghCount} · ${fmtTime(ghFetchedAt)}`;
          setStatus(`Imported ${ghCount} domains`, 2000);
        } catch (e) {
          console.error(e);
          setStatus("Failed to import list", 2200);
        }
      });

      panel.querySelector("#gh-clear").addEventListener("click", async () => {
        await chrome.storage.local.set({ [KEY_GH_LIST]: [], [KEY_GH_FETCHED]: 0 });
        ghCount = 0;
        ghFetchedAt = 0;
        const ghChip = panel.querySelector("#gh-chip");
          if (ghChip) ghChip.textContent = `uBlockOrigin's AI blocklist: 0 · Never`;
        setStatus("Cleared uBlockOrigin's AI blocklist", 1800);
      });

      // Allowlist save/cancel
      const allowTa = () => panel.querySelector("#allow-ta");
      panel.querySelector("#allow-cancel").addEventListener("click", () => {
        allowTa().value = listToTextarea(allowlist);
      });
      panel.querySelector("#allow-save").addEventListener("click", async () => {
        const newAL = parseDomainTextarea(allowTa().value);
        await saveAllowlist(newAL);
        allowlist.length = 0; allowlist.push(...newAL);
        panel.querySelector("#allow-chip").textContent = `Allowlist: ${allowlist.length}`;
        setStatus("Allowlist saved", 1800);
      });

      // Blocklist save/cancel
      const blockTa = () => panel.querySelector("#block-ta");
      panel.querySelector("#block-cancel").addEventListener("click", () => {
        blockTa().value = listToTextarea(blocklist);
      });
      panel.querySelector("#block-save").addEventListener("click", async () => {
        const newBL = parseDomainTextarea(blockTa().value);
        await saveBlocklist(newBL);
        blocklist.length = 0; blocklist.push(...newBL);
        panel.querySelector("#block-chip").textContent = `Custom blocklist: ${blocklist.length}`;
        setStatus("Blocklist saved", 1800);
      });
    }

    // Cutoff year editor (keep original feel, but compact)
    if (f.key === "warn_post_year") {
      const editorWrap = document.createElement("div");
      editorWrap.style.margin = "6px 0 4px";

      const info = document.createElement("div");
      info.className = "desc";
      info.style.marginTop = "6px";
      info.innerHTML = `Cutoff year: <strong id="cutoff-display">${cutoffyear}</strong>`;
      editorWrap.appendChild(info);

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "Change year";
      editBtn.className = "btn";
      editBtn.style.marginTop = "10px";
      editorWrap.appendChild(editBtn);

      const panel = document.createElement("div");
      panel.className = "panel";
      panel.style.display = "none";
      panel.innerHTML = `
        <div style="display:grid; gap:10px;">
          <label class="title" for="cutoff-input">Set cutoff year</label>
          <input id="cutoff-input" type="number" min="1990" max="2100"
                 style="width:140px; background:#0a0f1c; color:#e5e7eb; border:1px solid rgba(255,255,255,.14); border-radius:12px; padding:10px;"
                 value="${cutoffyear}">
          <div class="desc">Pages updated after this year trigger a warning.</div>
          <div style="display:flex; gap:8px; justify-content:flex-end;">
            <button id="cancel-cutoff" class="btn" type="button">Cancel</button>
            <button id="save-cutoff" class="btn" type="button">Save year</button>
          </div>
        </div>
      `;
      editorWrap.appendChild(panel);
      featuresEl.appendChild(editorWrap);

      const cutoffDisplay = () => info.querySelector("#cutoff-display");
      const cutoffInput = () => panel.querySelector("#cutoff-input");

      editBtn.addEventListener("click", () => {
        const showing = panel.style.display !== "none";
        panel.style.display = showing ? "none" : "block";
      });

      panel.querySelector("#cancel-cutoff").addEventListener("click", () => {
        panel.style.display = "none";
      });

      panel.querySelector("#save-cutoff").addEventListener("click", async () => {
        let val = parseInt(cutoffInput().value, 10);
        if (!Number.isFinite(val)) val = DEFAULT_CUTOFF_YEAR;
        val = Math.min(2100, Math.max(1990, val));
        await saveCutOffYear(val);
        cutoffyear = val;
        cutoffDisplay().textContent = String(val);
        setStatus("Cutoff year saved", 1800);
        panel.style.display = "none";
      });
    }
  });
}

// Init
async function init() {
  featuresEl = document.getElementById("features");
  statusEl = document.getElementById("status");
  resetBtn = document.getElementById("reset");

  if (!featuresEl || !statusEl || !resetBtn) {
    console.error("[UnAIfy] Missing DOM nodes (#features, #status, #reset)");
    return;
  }

  const state = await loadState();
  await syncGoogleSGE(state.toggles);
  render(state);

  resetBtn.addEventListener("click", async () => {
    const defaultToggles = Object.fromEntries(FEATURES.map(f => [f.key, false]));
    defaultToggles.use_uBlockOrigin_blacklist = false;

    await Promise.all([
      saveToggles(defaultToggles),
      saveBlocklist([]),
      saveAllowlist([]),
      saveCutOffYear(DEFAULT_CUTOFF_YEAR),
      chrome.storage.local.set({ [KEY_GH_LIST]: [], [KEY_GH_FETCHED]: 0 })
    ]);

    await syncGoogleSGE(defaultToggles);

    const fresh = await loadState();
    render(fresh);
    setStatus("Reset to defaults", 1600);
  });

  setStatus("Ready", 800);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}