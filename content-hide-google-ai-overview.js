// content-hide-google-ai-overview.js — UnAIfy
// Toggle-aware version built from your working template (multi-language headings).
// - Reads chrome.storage.sync.unAIfySettings.hide_sge
// - Hides only the AI Overview module + related “People also ask” rows mentioning AI Overview
// - Never hides big wrappers (#search/#rcnt/main/body)
// - Cleanly restores styles when the toggle is OFF

(() => {
  "use strict";

  // ---- config / markers ----
  const MARK_AI = "data-unAIfy-sge-hidden";
  const MARK_PAA = "data-unAIfy-sge-paa-hidden";
  const MARK_PAD = "data-unAIfy-sge-pad";
  const MARK_MARGIN = "data-unAIfy-sge-margin";

  // Multi-language patterns for the “AI Overview” title / copy
  // (lifted from your template and extended to a case-insensitive bundle)
  const patterns = [
    /übersicht mit ki/i,                 // de
    /ai overview/i,                      // en
    /prezentare generală generată de ai/i, // ro
    /AI による概要/,                         // ja
    /Обзор от ИИ/,                         // ru
    /AI 摘要/,                             // zh-TW
    /AI-overzicht/i,                     // nl
    /Vista creada con IA/i,              // es
    /Přehled od AI/i,                    // cs
  ];

  // Small module containers in Google SERPs we’re allowed to hide
  const MODULE_SELECTORS = [
    ".Ww4FFb", ".MjjYud", ".xpd", "[data-sokoban-container]", "[data-hveid]", ".g"
  ].join(", ");

  // ---- state ----
  let enabled = true;
  let observer = null;
  let lastUrl = location.href;

  // ---- storage helper ----
  const storage = {
    get: (k) => new Promise((res) => chrome.storage.sync.get(k, res))
  };

  // ---- utils ----
  function isBigWrapper(el) {
    if (!el) return true;
    const tag = (el.tagName || "").toLowerCase();
    return (
      el === document.body ||
      el === document.documentElement ||
      el.id === "search" ||
      el.id === "rcnt" ||
      tag === "main"
    );
  }

  function markHide(el, markAttr) {
    if (!el || el.hasAttribute(markAttr)) return;
    el.dataset.unAIfyPrevDisplay = el.style.display || "";
    el.style.display = "none";
    el.setAttribute(markAttr, "1");
  }

  function unmarkAll(markAttr) {
    document.querySelectorAll("[" + markAttr + "]").forEach((el) => {
      el.style.display = el.dataset.unAIfyPrevDisplay || "";
      delete el.dataset.unAIfyPrevDisplay;
      el.removeAttribute(markAttr);
    });
  }

  // ---- template-inspired detectors (adapted) ----
  // 1) Find a heading <h1>/<h2> inside #rcnt whose text matches any pattern
  function findAIHeading() {
    const rcnt = document.querySelector("div#rcnt");
    if (!rcnt) return null;
    const heads = rcnt.querySelectorAll("h1, h2");
    for (const h of heads) {
      const t = h.innerText || h.textContent || "";
      if (patterns.some((re) => re.test(t))) return h;
    }
    return null;
  }

  // 2) From that heading, find the AI Overview container:
  //    try “as a result card” in #rso, else “above results” in #rcnt direct child
  function findAIOverviewModuleFromHeading(h) {
    if (!h) return null;
    let mod =
      h.closest("div#rso > div") || // Overview nestled in results cluster
      h.closest("div#rcnt > div");  // Overview above results
    if (!mod || isBigWrapper(mod)) return null;

    // Tighten to a reasonable module container if possible
    const tighter = h.closest(MODULE_SELECTORS);
    if (tighter && !isBigWrapper(tighter)) mod = tighter;

    return mod;
  }

  // 3) People also ask rows that themselves contain “AI overview” strings
  function findPeopleAlsoAskAI() {
    const rows = document.querySelectorAll("div.related-question-pair");
    const hits = [];
    for (const row of rows) {
      const html = row.innerHTML || "";
      if (patterns.some((re) => re.test(html))) {
        // Hide the pair’s container (same level Google uses to wrap the Q/A)
        const container = row.parentElement?.parentElement;
        if (container && !isBigWrapper(container)) hits.push(container);
      }
    }
    return hits;
  }

  // 4) Cosmetic tweaks like your template: header tabs padding, main margin
  function applyCosmetics() {
    const headerTabs = document.querySelector("div#hdtb-sc > div");
    if (headerTabs && !headerTabs.hasAttribute(MARK_PAD)) {
      headerTabs.dataset.unAIfyPrevPaddingBottom = headerTabs.style.paddingBottom || "";
      headerTabs.style.paddingBottom = "12px";
      headerTabs.setAttribute(MARK_PAD, "1");
    }
    const main = document.querySelector('[role="main"]');
    if (main && !main.hasAttribute(MARK_MARGIN)) {
      main.dataset.unAIfyPrevMarginTop = main.style.marginTop || "";
      main.style.marginTop = "24px";
      main.setAttribute(MARK_MARGIN, "1");
    }
  }

  function undoCosmetics() {
    const headerTabs = document.querySelector("div#hdtb-sc > div[" + MARK_PAD + "]");
    if (headerTabs) {
      headerTabs.style.paddingBottom = headerTabs.dataset.unAIfyPrevPaddingBottom || "";
      delete headerTabs.dataset.unAIfyPrevPaddingBottom;
      headerTabs.removeAttribute(MARK_PAD);
    }
    const main = document.querySelector('[role="main"][' + MARK_MARGIN + "]");
    if (main) {
      main.style.marginTop = main.dataset.unAIfyPrevMarginTop || "";
      delete main.dataset.unAIfyPrevMarginTop;
      main.removeAttribute(MARK_MARGIN);
    }
  }

  // ---- one-pass apply / undo ----
  function hideOnce() {
    if (!enabled) return false;

    // Heading → module
    const h = findAIHeading();
    const aiModule = findAIOverviewModuleFromHeading(h);
    if (aiModule) markHide(aiModule, MARK_AI);

    // PAA rows that mention AI Overview
    const paMods = findPeopleAlsoAskAI();
    paMods.forEach((m) => markHide(m, MARK_PAA));

    // Cosmetic tidy
    applyCosmetics();

    return !!aiModule || paMods.length > 0;
  }

  function unhideAll() {
    unmarkAll(MARK_AI);
    unmarkAll(MARK_PAA);
    undoCosmetics();
  }

  // ---- observer / url watcher ----
  function ensureObserver(on) {
    if (on && !observer) {
      observer = new MutationObserver(() => enabled && hideOnce());
      observer.observe(document, { childList: true, subtree: true });
    } else if (!on && observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function startUrlWatcher() {
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        unhideAll();
        if (enabled) hideOnce();
      }
    }, 700);
  }

  function apply() {
    if (enabled) {
      hideOnce();
      ensureObserver(true);
    } else {
      ensureObserver(false);
      unhideAll();
    }
  }

  // ---- live toggle from popup ----
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.unAIfySettings) return;
    const next = !!changes.unAIfySettings.newValue?.hide_sge;
    if (next !== enabled) {
      enabled = next;
      apply();
    }
  });

  // ---- init ----
  (async () => {
    try {
      const { unAIfySettings } = await storage.get("unAIfySettings");
      // default ON if unset
      enabled = !!(unAIfySettings ? unAIfySettings.hide_sge : true);
    } catch {
      enabled = true;
    }
    startUrlWatcher();
    apply();
    // late hydration pass
    setTimeout(() => enabled && hideOnce(), 600);
  })();
})();