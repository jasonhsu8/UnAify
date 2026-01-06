// content-blacklist.js — UnAIfy: hide GitHub-blocklisted domains on Google SERPs (MV3)
(() => {
  "use strict";

  const LOG_PREFIX = "[UnAIfy]";

  // Storage keys
  const SYNC_KEYS = { settings: "unAIfySettings" };
  const LOCAL_KEYS = { githubList: "unAIfyGithubBlacklist" };

  // Toggle keys (MUST match popup.js FEATURES keys)
  const TOGGLE_FILTER = "filter_ai_domains";
  const TOGGLE_GITHUB = "use_uBlockOrigin_blacklist";

  const state = {
    enabled: true,
    useGithub: true,
    blacklist: [],
    observer: null
  };

  const storageSync = {
    get(keys) {
      return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
    }
  };
  const storageLocal = {
    get(keys) {
      return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
    }
  };

  // ---- domain helpers ----
  const stripWWW = (h) => h.replace(/^www\./i, "");

  function normalizeDomain(input) {
    if (!input) return null;
    let s = String(input).trim().toLowerCase();
    if (!s) return null;

    // strip comments and paths
    s = s.split("#")[0].trim();
    s = s.replace(/^https?:\/\//, "");
    s = s.replace(/^www\./, "");
    s = s.split("/")[0].split("?")[0].split("#")[0];

    if (!/[a-z0-9-]+\.[a-z0-9.-]+$/.test(s)) return null;
    return s;
  }

  function suffixMatches(host, domain) {
    return host === domain || host.endsWith("." + domain);
  }

  function isBlacklisted(host) {
    for (const d of state.blacklist) {
      if (suffixMatches(host, d)) return true;
    }
    return false;
  }

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

  // ---- hide/restore helpers ----
  const MARK_FILTERED = "data-unAIfy-filtered";

  function findResultContainer(node) {
    return (
      node.closest(".MjjYud, .g, .xpd, .Ww4FFb, [data-sokoban-container]") ||
      node.closest("#search > div") ||
      node.closest("#search") ||
      null
    );
  }

  function hideContainer(el) {
    if (!el || el.hasAttribute(MARK_FILTERED)) return;
    el.dataset.unAIfyPrevDisplay = el.style.display || "";
    el.style.display = "none";
    el.setAttribute(MARK_FILTERED, "1");
  }

  function restoreAllFiltered() {
    document.querySelectorAll("[" + MARK_FILTERED + "]").forEach((el) => {
      el.style.display = el.dataset.unAIfyPrevDisplay || "";
      delete el.dataset.unAIfyPrevDisplay;
      el.removeAttribute(MARK_FILTERED);
      el.__unAIfyChecked = false;
      el.__unAIfyHidden = false;
    });
  }

  function hideBlacklistedResults(root = document) {
    if (!state.enabled || !state.useGithub) return;
    if (!state.blacklist.length) return;

    const searchRoot = root.querySelector("#search") || root;
    const anchors = searchRoot.querySelectorAll('a[href^="http"], a[href^="/url?"]');

    anchors.forEach((a) => {
      if (a.__unAIfyChecked) return;
      a.__unAIfyChecked = true;

      const targetUrl = extractTargetUrlFromAnchor(a);
      if (!targetUrl) return;

      const host = getHostnameFromAnyUrl(targetUrl);
      if (!host) return;

      // don’t hide Google internal navigation
      if (/\bgoogle\./.test(host)) return;

      if (isBlacklisted(host)) {
        const container = findResultContainer(a);
        if (container && !container.__unAIfyHidden) {
          container.__unAIfyHidden = true;
          hideContainer(container);
        }
      }
    });
  }

  function setupObserver() {
    const root = document.querySelector("#search") || document.body;
    if (!root) return;

    if (state.observer) state.observer.disconnect();

    state.observer = new MutationObserver(() => {
      Promise.resolve().then(() => hideBlacklistedResults(root));
    });

    state.observer.observe(root, { childList: true, subtree: true });
  }

  async function refreshBlacklist() {
    const { [SYNC_KEYS.settings]: toggles = {} } = await storageSync.get([SYNC_KEYS.settings]);
    const { [LOCAL_KEYS.githubList]: githubRaw = [] } = await storageLocal.get([LOCAL_KEYS.githubList]);

    state.enabled = !!(toggles?.[TOGGLE_FILTER] ?? true);
    state.useGithub = !!(toggles?.[TOGGLE_GITHUB] ?? true);

    const githubList = Array.isArray(githubRaw) ? githubRaw : [];
    state.blacklist = githubList
      .map(normalizeDomain)
      .filter(Boolean);

    // dedupe
    state.blacklist = Array.from(new Set(state.blacklist));

    console.info(LOG_PREFIX, "Blacklist refreshed:", {
      enabled: state.enabled,
      useGithub: state.useGithub,
      count: state.blacklist.length
    });
  }

  // React to changes (sync settings or local list updates)
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync" && area !== "local") return;

    const relevant = !!changes[SYNC_KEYS.settings] || !!changes[LOCAL_KEYS.githubList];
    if (!relevant) return;

    await refreshBlacklist();

    // Reset scan flags
    document.querySelectorAll("#search a").forEach((a) => (a.__unAIfyChecked = false));

    if (!state.enabled || !state.useGithub) {
      restoreAllFiltered();
      return;
    }
    hideBlacklistedResults();
  });

  async function init() {
    console.info(LOG_PREFIX, "content-blacklist injected on", location.href);

    await refreshBlacklist();

    if (!state.enabled || !state.useGithub) {
      console.info(LOG_PREFIX, "Filtering disabled (toggle off).");
      return;
    }

    if (!state.blacklist.length) {
      console.info(LOG_PREFIX, "No GitHub blacklist imported yet. Open the popup and click Refresh.");
      return;
    }

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
  }

  init();
})();