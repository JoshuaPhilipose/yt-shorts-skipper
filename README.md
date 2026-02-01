# YouTube Shorts Auto-Skipper

Chrome extension (Manifest V3) that automatically skips YouTube Shorts below a configurable like threshold.

## Install

1. Open `chrome://extensions`, enable Developer mode
2. Click **Load unpacked**, select the `yt-shorts-skipper/` directory
3. Navigate to `youtube.com/shorts/` — badge shows "ON" when active

## Configuration

Right-click extension icon > **Options**. Default threshold: 1000 likes.

## How It Works

**Content script** (`content.js`) runs only on `youtube.com/shorts/*`. A runtime route guard deactivates all logic if the user SPA-navigates away from Shorts.

### Detection

A MutationObserver on the Shorts container detects navigation between Shorts. Every mutation restarts an 800ms settle timer — processing only begins after mutations stop. This prevents reading stale DOM during skip animations.

### Like Count Extraction

Queries are scoped to the **active renderer** (`ytd-reel-video-renderer[is-active]`), not the whole document — YouTube pre-renders multiple Shorts simultaneously. A fallback chain of selectors + ARIA label parsing handles DOM structure changes. Diagnostic logging dumps element details when all selectors fail.

Three outcomes:
- **Number found** (e.g. "432", "1.2K") — parsed and compared to threshold
- **Element found, empty text or "Like"** — treated as 0 likes (immediate skip)
- **Element not found** — polls every 400ms up to 4s, then treats as 0

### Autoplay Next

When a kept Short finishes playing, the extension automatically advances to the next one. This is enabled by default and can be toggled in Options ("Auto-advance when Short ends").

YouTube sets `video.loop = true` on Shorts so the native `ended` event never fires. The extension leaves loop intact and instead listens for `timeupdate`: once `currentTime` reaches the last 0.5 seconds a flag is set, and when `currentTime` then jumps back below 1 second (loop restart) it calls `skipShort()` to advance.

Listeners are cleaned up when navigating away from Shorts, when a new Short is processed, or when the feature is toggled off in settings.

### Skipping

Dispatches an `ArrowDown` KeyboardEvent, which uses YouTube's own navigation handler. `scrollBy()` was tested but leaves YouTube's internal state inconsistent.

Consecutive skip cap: 20 (prevents infinite loops when all Shorts are below threshold).

## Files

```
yt-shorts-skipper/
  manifest.json    — extension config, content script match pattern
  content.js       — route guard, observer, like extraction, skip logic
  background.js    — badge state (ON/blank) per tab
  options.html/js  — threshold configuration UI
  icons/           — placeholder PNGs
```
