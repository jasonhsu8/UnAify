// content-google.js — UnAIfy: filter blacklisted domains on Google SERPs

(() => {
  const LOG_PREFIX = "[UnAIfy]";
  const settings = {
    toggles: { filter_ai_domains: true }, // default on
    blacklist: []
  };

  // ---- Promisified storage helpers (MV3-safe) ----
  const storage = {
    get(keys) {
      return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
    },
    set(obj) {
      return new Promise((resolve) => chrome.storage.sync.set(obj, resolve));
    }
  };

  // ---- Domain helpers ----
  const stripWWW = (h) => h.replace(/^www\./i, "");
  function getHostnameFromAnyUrl(u) {
    try {
      return stripWWW(new URL(u).hostname.toLowerCase());
    } catch {
      return "";
    }
  }
  function extractTargetUrlFromAnchor(a) {
    const href = a.getAttribute("href") || "";
    // Google wraps external links as /url?q=<target>
    if (href.startsWith("/url?")) {
      try {
        const u = new URL(href, location.origin);
        const q = u.searchParams.get("q");
        if (q) return q;
      } catch {}
    }
    if (href.startsWith("http")) return href;
    return null;
  }
  function suffixMatches(host, domain) {
    // Exact or subdomain match (example.com matches a.example.com, example.com)
    return host === domain || host.endsWith("." + domain);
  }
  function isBlacklisted(host) {
    if (!host) return false;
    for (const d of settings.blacklist) {
      if (suffixMatches(host, d)) return true;
    }
    return false;
  }

  // ---- Result hiding ----
  function findResultContainer(node) {
    // Try common SERP containers; fallback to nearest block inside #search
    return (
      node.closest(".MjjYud, .g, .xpd, .Ww4FFb, [data-sokoban-container]") ||
      node.closest("#search > div") ||
      node.closest("#search") ||
      null
    );
  }

  function hideBlacklistedResults(root = document) {
    if (!settings.toggles.filter_ai_domains) return;

    const searchRoot = root.querySelector("#search") || root;
    const anchors = searchRoot.querySelectorAll('a[href^="http"], a[href^="/url?"]');

    anchors.forEach((a) => {
      if (a.__unAIfyChecked) return;
      a.__unAIfyChecked = true;

      const targetUrl = extractTargetUrlFromAnchor(a);
      if (!targetUrl) return;

      const host = getHostnameFromAnyUrl(targetUrl);
      if (!host) return;

      // Skip Google-owned domains to avoid nuking nav
      if (/\bgoogle\./.test(host)) return;

      if (isBlacklisted(host)) {
        const container = findResultContainer(a);
        if (container && !container.__unAIfyHidden) {
          container.__unAIfyHidden = true;
          container.style.display = "none";
          container.setAttribute("data-unAIfy", "filtered");
        }
      }
    });
  }

  // ---- React to DOM changes (Google updates results in place) ----
  let observer;
  function setupObserver() {
    const root = document.querySelector("#search") || document.body;
    if (!root) return;
    if (observer) observer.disconnect();

    observer = new MutationObserver((muts) => {
      // Throttle by scheduling a microtask
      Promise.resolve().then(() => hideBlacklistedResults(root));
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  // ---- React to URL changes (SPA-style navigation) ----
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Reset markers so we can process new results
      document.querySelectorAll("[data-unAIfy='filtered']").forEach((el) => {
        el.style.display = ""; // allow re-evaluation (in case blacklist changed)
        el.removeAttribute("data-unAIfy");
        el.__unAIfyHidden = false;
      });
      hideBlacklistedResults();
    }
  }, 800);

  // ---- Listen for settings changes from popup ----
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    let needRescan = false;

    if (changes.unAIfySettings) {
      settings.toggles = {
        ...settings.toggles,
        ...(changes.unAIfySettings.newValue || {})
      };
      needRescan = true;
    }
    if (changes.unAIfyBlacklist) {
      settings.blacklist = Array.isArray(changes.unAIfyBlacklist.newValue)
        ? changes.unAIfyBlacklist.newValue.map((s) => s.toLowerCase())
        : [];
      needRescan = true;
    }
    if (needRescan) {
      // Clear processed flags to ensure fresh pass
      document.querySelectorAll("#search a").forEach((a) => (a.__unAIfyChecked = false));
      hideBlacklistedResults();
    }
  });

  // ---- Init ----
  async function init() {
    const {
      unAIfySettings = { filter_ai_domains: true },
      unAIfyBlacklist = []
    } = await storage.get(["unAIfySettings", "unAIfyBlacklist"]);

    settings.toggles = { ...settings.toggles, ...(unAIfySettings || {}) };
    settings.blacklist = (unAIfyBlacklist || []).map((s) => s.toLowerCase());

    setupObserver();
    hideBlacklistedResults();
    // In case #search appears late:
    const readyCheck = setInterval(() => {
      const search = document.querySelector("#search");
      if (search) {
        clearInterval(readyCheck);
        setupObserver();
        hideBlacklistedResults(search);
      }
    }, 250);

    console.info(LOG_PREFIX, "Google filter ready");
  }

  init();
})();