// content-blacklist.js — UnAIfy: filter blacklisted domains on Google SERPs
(() => {
  "use strict";

  const LOG_PREFIX = "[UnAIfy]";
  const REMOTE_BLACKLIST_URL = "PUT_YOUR_RAW_GITHUB_URL_HERE"; // e.g. https://raw.githubusercontent.com/user/repo/main/blacklist.txt

  // If user hasn't opened popup yet, storage may be empty -> fallback list keeps feature working.
  const DEFAULT_FALLBACK_BLACKLIST = [
    "perplexity.ai",
    "deepai.org",
    "gemini.google.com",
    "openai.com",
    "aixploria.com",
    "scite.ai"
  ];

  // Cache remote list so you don't fetch it on every Google search page load
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  const STORAGE_KEYS = {
    settings: "unAIfySettings",
    localList: "unAIfyBlacklist",
    remoteCache: "unAIfyRemoteBlacklistCache",
    remoteFetchedAt: "unAIfyRemoteBlacklistFetchedAt"
  };

  const state = {
    enabled: true,             // filter_ai_domains toggle
    blacklist: [],             // merged final list
    observer: null
  };

  // MV3-safe storage helpers
  const storage = {
    get(keys) {
      return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
    },
    set(obj) {
      return new Promise((resolve) => chrome.storage.sync.set(obj, resolve));
    }
  };

  const storageLocal = {
  get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
};


  // -------------------------
  // Domain parsing helpers
  // -------------------------
  const stripWWW = (h) => h.replace(/^www\./i, "");

  function normalizeDomain(input) {
    if (!input) return null;
    let s = String(input).trim().toLowerCase();
    if (!s) return null;

    // Remove inline comments for common list formats
    s = s.replace(/\s+#.*$/, "");
    s = s.replace(/\s+!.*$/, "");
    s = s.replace(/\s+\/\/.*$/, "");

    // hosts-file style: "0.0.0.0 example.com"
    // keep the last token
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && /^\d{1,3}(\.\d{1,3}){3}$/.test(parts[0])) {
      s = parts[parts.length - 1];
    } else {
      s = parts[0] || "";
    }

    // Adblock-ish: "||example.com^"
    if (s.startsWith("||")) s = s.slice(2);
    s = s.replace(/\^.*$/, ""); // drop suffix modifiers after ^
    s = s.replace(/^\*+/, "").replace(/\*+$/, "");

    // Strip protocol and www
    s = s.replace(/^https?:\/\//, "");
    s = s.replace(/^www\./, "");

    // Drop path/query/hash
    s = s.split("/")[0].split("?")[0].split("#")[0];

    // Basic "has a dot" domain validation
    if (!/[a-z0-9-]+\.[a-z0-9-.]+$/.test(s)) return null;

    return s;
  }

  function parseDomainListText(text) {
    const out = [];
    const seen = new Set();
    const lines = String(text || "").split(/\r?\n/);
    for (const line of lines) {
      const dom = normalizeDomain(line);
      if (dom && !seen.has(dom)) {
        seen.add(dom);
        out.push(dom);
      }
    }
    return out;
  }

  function suffixMatches(host, domain) {
    // exact or subdomain match
    return host === domain || host.endsWith("." + domain);
  }

  function isBlacklisted(host) {
    if (!host) return false;
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

  // -------------------------
  // Remote list (cached)
  // -------------------------
  async function getRemoteBlacklistCached() {
    if (!REMOTE_BLACKLIST_URL || REMOTE_BLACKLIST_URL.includes("PUT_YOUR_RAW")) {
      return [];
    }

    const {
      [STORAGE_KEYS.remoteCache]: cache = [],
      [STORAGE_KEYS.remoteFetchedAt]: fetchedAt = 0
    } = await storage.get([STORAGE_KEYS.remoteCache, STORAGE_KEYS.remoteFetchedAt]);

    const fresh = Number.isFinite(fetchedAt) && (Date.now() - fetchedAt) < CACHE_TTL_MS;
    if (fresh && Array.isArray(cache) && cache.length) return cache;

    try {
      const res = await fetch(REMOTE_BLACKLIST_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const list = parseDomainListText(text);

      await storage.set({
        [STORAGE_KEYS.remoteCache]: list,
        [STORAGE_KEYS.remoteFetchedAt]: Date.now()
      });

      console.info(LOG_PREFIX, "Remote blacklist loaded:", list.length);
      return list;
    } catch (e) {
      console.warn(LOG_PREFIX, "Remote blacklist fetch failed, using cached if any.", e);
      return Array.isArray(cache) ? cache : [];
    }
  }

  // -------------------------
  // Hiding + restoring results
  // -------------------------
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

    const searchRoot = root.querySelector("#search") || root;
    const anchors = searchRoot.querySelectorAll('a[href^="http"], a[href^="/url?"]');

    anchors.forEach((a) => {
      if (a.__unAIfyChecked) return;
      a.__unAIfyChecked = true;

      const targetUrl = extractTargetUrlFromAnchor(a);
      if (!targetUrl) return;

      const host = getHostnameFromAnyUrl(targetUrl);
      if (!host) return;

      // Avoid nuking Google internal navigation
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
      // Cheap throttle via microtask
      Promise.resolve().then(() => hideBlacklistedResults(root));
    });
    state.observer.observe(root, { childList: true, subtree: true });
  }

  // -------------------------
  // Load + merge settings/list
  // -------------------------
  function mergeUnique(a, b) {
    const out = [];
    const seen = new Set();
    for (const x of [...(a || []), ...(b || [])]) {
      const d = normalizeDomain(x);
      if (d && !seen.has(d)) {
        seen.add(d);
        out.push(d);
      }
    }
    return out;
  }

  async function refreshMergedBlacklist() {
    const {
      [STORAGE_KEYS.settings]: unAIfySettings = {},
      [STORAGE_KEYS.localList]: localListRaw = []
    } = await storage.get([STORAGE_KEYS.settings, STORAGE_KEYS.localList]);

    state.enabled = !!(unAIfySettings?.filter_ai_domains ?? true);

    // If user never opened popup, localListRaw may be missing/empty -> fallback list
    const localList =
      Array.isArray(localListRaw) && localListRaw.length
        ? localListRaw
        : DEFAULT_FALLBACK_BLACKLIST;

    const remoteList = state.enabled ? await getRemoteBlacklistCached() : [];

    state.blacklist = mergeUnique(remoteList, localList);
    console.info(LOG_PREFIX, "Blacklist active:", state.enabled, "domains:", state.blacklist.length);
  }

  // -------------------------
  // React to toggle/list changes
  // -------------------------
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync" && area !== "local") return;

    let needRescan = false;

    // Existing: settings/toggle changes (stored in sync)
    if (changes.unAIfySettings) {
      const newSettings = changes.unAIfySettings.newValue || {};
      settings.toggles = { ...settings.toggles, ...newSettings };
      needRescan = true;
    }

    // Existing: local editable blacklist changes (stored in sync)
    if (changes.unAIfyBlacklist) {
      settings.blacklist = changes.unAIfyBlacklist.newValue || [];
      needRescan = true;
    }

    // ✅ NEW: GitHub blacklist cache changes (stored in local)
    if (changes.unAIfyGithubBlacklist) {
      // only re-merge if toggle is enabled; otherwise ignore
      const useGithub = !!settings.toggles.use_github_blacklist;
      if (useGithub) {
        const githubList = Array.isArray(changes.unAIfyGithubBlacklist.newValue)
          ? changes.unAIfyGithubBlacklist.newValue.map(s => String(s).toLowerCase())
          : [];

        settings.blacklist = Array.from(new Set([
          ...(settings.blacklist || []).filter(Boolean), // current merged list
          ...githubList
        ]));

        needRescan = true;
      }
    }

    if (needRescan) {
      document.querySelectorAll("#search a").forEach(a => a.__unAIfyChecked = false);

      // If filtering was disabled, restore any hidden results
      if (!settings.toggles.filter_ai_domains) {
        restoreHiddenResults();
        return;
      }

      hideBlacklistedResults();
    }
  });


  // -------------------------
  // Init
  // -------------------------
  // ---- Init ----
  async function init() {
    // 1) Load settings + user editable blacklist from SYNC (your existing approach)
    const {
      unAIfySettings = { filter_ai_domains: true, use_github_blacklist: false },
      unAIfyBlacklist = []
    } = await storage.get(["unAIfySettings", "unAIfyBlacklist"]);

    // 2) Load cached GitHub blacklist from LOCAL (downloaded by popup.js)
    const { unAIfyGithubBlacklist = [] } = await new Promise((resolve) =>
      chrome.storage.local.get(["unAIfyGithubBlacklist"], resolve)
    );

    // 3) Merge settings
    settings.toggles = { ...settings.toggles, ...(unAIfySettings || {}) };

    // 4) Normalize lists
    const localList = Array.isArray(unAIfyBlacklist)
      ? unAIfyBlacklist.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
      : [];

    const githubList = Array.isArray(unAIfyGithubBlacklist)
      ? unAIfyGithubBlacklist.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
      : [];

    // 5) Fallback so it "works" even before user has saved any list
    const DEFAULT_FALLBACK_BLACKLIST = [
      "perplexity.ai",
      "deepai.org",
      "gemini.google.com",
      "openai.com"
    ];

    const useGithub = !!settings.toggles.use_github_blacklist;

    // 6) Build the final blacklist (deduped)
    const merged = [
      ...(localList.length ? localList : DEFAULT_FALLBACK_BLACKLIST),
      ...(useGithub ? githubList : [])
    ];

    settings.blacklist = Array.from(new Set(merged));

    // 7) Start observing + run first pass
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

    console.info(LOG_PREFIX, "Google filter ready", {
      filter_ai_domains: !!settings.toggles.filter_ai_domains,
      use_github_blacklist: useGithub,
      mergedCount: settings.blacklist.length
    });
  }
})();