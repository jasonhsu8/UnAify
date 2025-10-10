chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (
    tab.url &&
    tab.url.includes("://www.google.com/search") &&
    changeInfo.status == "loading"
  ) {
    chrome.storage.local.get(["overviewClass"], function (result) {
      if (result.overviewClass) {
        // If an ID is stored, inject CSS to hide the element with that ID
        const classNames = result.overviewClass.split(" ");
        const cssCode = classNames
          .map((className) => `.${className} { display: none !important; }`)
          .join(" ");
        chrome.scripting.insertCSS(
          {
            target: { tabId: tabId },
            css: cssCode,
          },
          () => {
            console.log(`AI Overview class "${result.overviewClass}" hidden`);
          }
        );
      }
    });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if(changeInfo.status !== "loading" || !tab.url) return;
  const isGoogleSearch = 
    tab.url.startsWith("http://www.google.com/search") ||
    tab.url.startsWith("http://www.google.co.uk/search");
  if (!isGoogleSearch) return;

  const [{unAIfySettings}, {overviewClass}] = await Promise.all([
    chrome.storage.sync.get("unAIfySettings"),
    chrome.storage.local.get("overviewClass")
  ]);
  const hide = !!(unAIfySettings ? unAIfySettings.hide_sge : true);

  // Build css from the stored class names (if needed / if any)
  const cssCode = (overviewClass ? overviewClass.spliot(/\s+/).filter(Boolean): [])
  .map(cls => `.${cls} {display: none !important; }`)
.join("");

if (!cssCode) return;

try {
  if(hide) {
    await chrome.scripting.insertCSS({target: {tabId}, css: cssCode});
  } else {
    await chrome.scripting.removeCSS({target: {tabId}, css: cssCode});
  }
} catch(e) {
  // no-op if CSS can't be applied/removed on this page
}
});

// If user flips the toggle while on Google, remove injected CSS
chrome.storage.onChanged.addListner(async (changes, area) => {
  if (area !== "sybc" || !changes.unAIfySettings) return;
  const newVal = changes.unAIfySettings.newValue || {};
  const hide = !!newVal.hide_sge;
  const {overviewClass} = await chrome.storage.local.get("overviewClass");
  const cssCode = (overviewClass ? overviewClass.split(/\s+/).filter(Boolean) : [])
    .map(cls => `.${cls} {display: none !important; }`)
    .join(" ");
  if(!cssCode) return;

  // removove CSS from all google tabs if turning OFF
  if (!hide) {
    const tabs = await chrome.tabs.query({url: ["https://www,google.com/*", "https://www.google.co.uk/*"]});
    await Promise.allSettked(
      tabs.map(t => chrome.scripting.removeCSS({target: {tabId: t.id}, css: cssCode}))
    );
  }
});
