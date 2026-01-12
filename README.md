# UnAify (Chrome Extension)
UnAIfy is a Chrome extension prototype that helps people reduce exposure to AI-mediated content online. The goal is to improve trust, learning, and decision-making during everyday browsing and encourage lower-carbon browsing by avoiding unnecessary AI consumption. This project is a Manifest V3 extension and is designed to be expanded after project submission.

## Features
### 1. Disable Google AI Overview
- Blocks (primary) or hides (secondary) Google's AI-generated "Overview" experience using a Declarative Net Request ruleset.

### 2. Filter AI-heavy domains
- Hides search results from domains that are likely to be AI-heavy.
    - Uses an external AI blocklist (thanks to laylavish) that can be imported from [GitHub](https://github.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist)
    - Support user control:
        - Allowlist: keeps domains visible even if they appear in the GitHub blocklist
        - Custom blocklist: add extra domains you personally want hidden
    - Designed so users decide what to enable (toggles are intended to be OFF by default)

### 3. Warning on post-2022 pages
- Shows a warning when a page appears to be created/updated after a cut off year (default is 2022). The cut off year is configurable in the pop up.


### Project structure (Key Files):
- *manifest.json*: Chrome extension manifest MV3
- *popup.html*: Extension pop up UI
- *popup.js*: Pop up logic contains toggles. settings, importing the GitHub list, allowlist/blocklist editing
- *content-blacklist.js*: Content script that hides blocked domains (currently focused on Google SERPs)
- *content-hide-google-ai=overview.js*: Content script logic relating to removing AI overview elements. This is a secondary/backup/fallback if the primary DNR ruleset fails.
- *content-warning.js*: Content script for the post-2022 warning feature
- *rules/google-ai-overview-off-redirect.json*: DNR ruleset used by the AI Overview Blocker


## Install Instructions (if you want to test/try it before wider public release):
1. Download the full UnAIfy zip file under **Code** to **Local** to **Download zip**
2. Unzip UnAIfy-main.zip
3. Open Chrome, go to chrome://extensions
4. Enable "Developer mode"
5. Click "Load unpacked"
6. Select the unzipped UnAIfy-main folder
7. Pin the extension to begin using!


### Using laylavish's AI blocklist
1. Open the UnAIfy pop up
2. Enable the **Filter AI-heavy Domains** feature (can be done before or after)
3. Open **AI Domain Controls**
4. Click **Refresh**
5. Optionally:
    - Add domains to **Allowlist** to keep them visible
    - Add domains to **Custom blocklist** to hide additional sites
6. Click **View source** to view laylavish's HUGE AI Blocklist


### UnAIfy Demo Videos
1.	[UnAIfy: Initial Pop-up Page Walkthrough](https://www.youtube.com/watch?v=6AEIeNPW6LU)
2.	[UnAIfy: Disable Google AI Overview Demo](https://www.youtube.com/watch?v=m-4OfxmHs18)
3.	[UnAIfy: Filter AI-heavy Domains Demo](https://www.youtube.com/watch?v=20sJ70zFkxw)
4.	[UnAIfy: Warning Post Cut Off Year Demo](https://www.youtube.com/watch?v=Sg0KfjdLjBY)


## License / Attribution
- UnAIfy is a university proof-of-concept / prototype project.
- Domain list imports are sourced from laylavish, a third-party public [GitHub list](https://github.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist)
