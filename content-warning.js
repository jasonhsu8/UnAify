// content-warning.js — UnAIfy: warn on post-year pages

(() => {
  const LOG_PREFIX = "[UnAIfy]";
  const settings = {
    toggles: { warn_post_year: true }, // default on
    cutoffYear: 2022
  };

  // ---- Promisified storage helpers (MV3-safe) ----
  const storage = {
    get(keys) {
      return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
    }
  };

  // ---- Date detectors (best-effort) ----
  function parseIsoMaybe(s) {
    if (!s) return null;
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function getFromMeta() {
    const metaProps = [
      'meta[property="article:published_time"]',
      'meta[property="article:modified_time"]',
      'meta[property="og:updated_time"]',
      'meta[name="publish-date"]',
      'meta[name="date"]',
      'meta[itemprop="datePublished"]',
      'meta[itemprop="dateModified"]'
    ];
    for (const sel of metaProps) {
      const el = document.querySelector(sel);
      const content = el?.getAttribute("content");
      const d = parseIsoMaybe(content);
      if (d) return d;
    }
    return null;
  }

  function getFromTimeTags() {
    const t = document.querySelector("time[datetime]");
    return t ? parseIsoMaybe(t.getAttribute("datetime")) : null;
  }

  function getFromLdJson() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const s of scripts) {
      try {
        const obj = JSON.parse(s.textContent || "null");
        if (!obj) continue;
        const arr = Array.isArray(obj) ? obj : [obj];
        for (const it of arr) {
          const d =
            parseIsoMaybe(it.dateModified) ||
            parseIsoMaybe(it.dateUpdated) ||
            parseIsoMaybe(it.datePublished);
          if (d) return d;
        }
      } catch {}
    }
    return null;
  }

  function getFromLastModified() {
    // Can be noisy (template changes), so we use it as a fallback
    const d = new Date(document.lastModified);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function detectPageDate() {
    return (
      getFromMeta() ||
      getFromTimeTags() ||
      getFromLdJson() ||
      getFromLastModified()
    );
  }

  // ---- UI banner ----
  function injectBanner(year, foundDate) {
    if (document.getElementById("unAIfy-postyear-banner")) return;

    const banner = document.createElement("div");
    banner.id = "unAIfy-postyear-banner";
    banner.innerHTML = `
      <div style="
        position:fixed; right:16px; bottom:16px; z-index:2147483647;
        background:#0b1220; color:#e5e7eb; border:1px solid #334155;
        border-radius:12px; padding:12px 14px; box-shadow:0 8px 24px rgba(0,0,0,.3);
        max-width:360px; font: 13px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;">
        <div style="display:flex; gap:10px; align-items:flex-start;">
          <div style="width:8px; height:8px; margin-top:6px; border-radius:50%; background:#f59e0b;"></div>
          <div style="flex:1;">
            <div style="font-weight:600; margin-bottom:2px;">UnAIfy - Heads up</div>
            <div>
              This page appears to be created or updated <strong>after ${year}</strong>${
      foundDate ? ` (detected: ${foundDate.toISOString().slice(0, 10)})` : ""
    }. Content from this period may rely more on AI tools.
            </div>
          </div>
          <button id="unAIfy-dismiss" aria-label="Dismiss" style="
            background:transparent; color:#9ca3af; border:0; cursor:pointer; font-size:16px; line-height:1;">✕</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(banner);

    banner.querySelector("#unAIfy-dismiss")?.addEventListener("click", () => {
      banner.remove();
      try {
        sessionStorage.setItem("unAIfy_dismiss", "1");
      } catch {}
    });
  }

  // ---- Main check ----
  function maybeWarn() {
    if (!settings.toggles.warn_post_year) return;
    if (sessionStorage.getItem("unAIfy_dismiss") === "1") return;

    const d = detectPageDate();
    if (!d) return; // no reliable signal

    const pageYear = d.getUTCFullYear();
    if (pageYear > settings.cutoffYear) {
      injectBanner(settings.cutoffYear, d);
    }
  }

  // ---- React to storage changes ----
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;

    if (changes.unAIfySettings) {
      settings.toggles = {
        ...settings.toggles,
        ...(changes.unAIfySettings.newValue || {})
      };
      // Re-evaluate if toggles flipped
      maybeWarn();
    }
    if (changes.unAIfyCutoffYear) {
      const v = changes.unAIfyCutoffYear.newValue;
      if (Number.isInteger(v)) {
        settings.cutoffYear = v;
        // Re-evaluate with new cutoff
        const banner = document.getElementById("unAIfy-postyear-banner");
        if (banner) banner.remove();
        maybeWarn();
      }
    }
  });

  // ---- Init ----
  async function init() {
    const {
      unAIfySettings = { warn_post_year: true },
      unAIfyCutoffYear = 2022
    } = await storage.get(["unAIfySettings", "unAIfyCutoffYear"]);

    settings.toggles = { ...settings.toggles, ...(unAIfySettings || {}) };
    settings.cutoffYear = Number.isInteger(unAIfyCutoffYear) ? unAIfyCutoffYear : 2022;

    // Run once on load; some sites hydrate late, so also retry quickly
    maybeWarn();
    setTimeout(maybeWarn, 1200);

    console.info(LOG_PREFIX, "Post-year warning ready");
  }

  init();
})();