// content-blacklist.js — UnAIfy: hide domains on Google SERPs (uBlockOrigin list + editable blocklist, with allowlist override)
(() => {
  "use strict";

  const LOG_PREFIX = "[UnAIfy]";

  // Storage keys
  const SYNC_KEYS = {
    settings: "unAIfySettings",
    blocklist: "unAIfyBlacklist",  // editable additions
    allowlist: "unAIfyAllowlist"   // editable overrides
  };
  const LOCAL_KEYS = {
    githubList: "unAIfyGithubBlacklist"
  };

  // Toggle keys (MUST MATCH popup.js)
  const TOGGLE_FILTER = "filter_ai_domains";
  const TOGGLE_GITHUB = "use_uBlockOrigin_blacklist";

  const state = {
    enabled: true,
    useGithub: true,
    blocklist: [],   // merged effective blocklist
    allowlist: [],
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

  // Domain Helpers
  const stripWWW = (h) => h.replace(/^www\./i, "");

  function normalizeDomain(input) {
    if (!input) return null;
    let s = String(input).trim().toLowerCase();
    if (!s) return null;

    // strip inline comments
    s = s.replace(/\s+#.*$/, "").replace(/\s+\/\/.*$/, "").trim();

    // strip protocol / www / path
    s = s.replace(/^https?:\/\//, "");
    s = s.replace(/^www\./, "");
    s = s.split("/")[0].split("?")[0].split("#")[0];

    if (!/[a-z0-9-]+\.[a-z0-9.-]+$/.test(s)) return null;
    return s;
  }

  function suffixMatches(host, domain) {
    return host === domain || host.endsWith("." + domain);
  }

  function isAllowed(host) {
    for (const d of state.allowlist) {
      if (suffixMatches(host, d)) return true;
    }
    return false;
  }

  function isBlocked(host) {
    for (const d of state.blocklist) {
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

  function mergeUnique(...lists) {
    const out = [];
    const seen = new Set();
    for (const list of lists) {
      for (const x of list || []) {
        const d = normalizeDomain(x);
        if (d && !seen.has(d)) {
          seen.add(d);
          out.push(d);
        }
      }
    }
    return out;
  }

  // Hide/Restore Helpers
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
    if (!state.enabled) return;
    if (!state.blocklist.length) return;

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

      // Allowlist overrides blocklist
      if (isAllowed(host)) return;

      if (isBlocked(host)) {
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

  async function refreshLists() {
    const sync = await storageSync.get([SYNC_KEYS.settings, SYNC_KEYS.blocklist, SYNC_KEYS.allowlist]);
    const local = await storageLocal.get([LOCAL_KEYS.githubList]);

    const toggles = sync[SYNC_KEYS.settings] || {};
    const customBlock = Array.isArray(sync[SYNC_KEYS.blocklist]) ? sync[SYNC_KEYS.blocklist] : [];
    const allow = Array.isArray(sync[SYNC_KEYS.allowlist]) ? sync[SYNC_KEYS.allowlist] : [];
    const github = Array.isArray(local[LOCAL_KEYS.githubList]) ? local[LOCAL_KEYS.githubList] : [];

    state.enabled = !!(toggles?.[TOGGLE_FILTER] ?? false);
    state.useGithub = !!(toggles?.[TOGGLE_GITHUB] ?? false);

    state.allowlist = mergeUnique(allow);

    const effectiveBlock = state.useGithub ? mergeUnique(github, customBlock) : mergeUnique(customBlock);
    // Remove anything allowlisted
    state.blocklist = effectiveBlock.filter((d) => !state.allowlist.includes(d));

    console.info(LOG_PREFIX, "Lists refreshed:", {
      enabled: state.enabled,
      useGithub: state.useGithub,
      blockCount: state.blocklist.length,
      allowCount: state.allowlist.length
    });
  }

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync" && area !== "local") return;

    const relevant =
      !!changes[SYNC_KEYS.settings] ||
      !!changes[SYNC_KEYS.blocklist] ||
      !!changes[SYNC_KEYS.allowlist] ||
      !!changes[LOCAL_KEYS.githubList];

    if (!relevant) return;

    await refreshLists();

    // Reset scan flags
    document.querySelectorAll("#search a").forEach((a) => (a.__unAIfyChecked = false));

    if (!state.enabled) {
      restoreAllFiltered();
      return;
    }
    hideBlacklistedResults();
  });

  async function init() {
    console.info(LOG_PREFIX, "content-blacklist injected on", location.href);

    await refreshLists();

    if (!state.enabled) {
      console.info(LOG_PREFIX, "Filtering disabled.");
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