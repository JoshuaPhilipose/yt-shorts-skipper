# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YouTube Shorts Auto-Skipper: A Chrome extension (Manifest V3) that automatically skips YouTube Shorts below a configurable like threshold.

## Development

No build step required. Load the extension directly in Chrome:
1. Open `chrome://extensions`, enable Developer mode
2. Click "Load unpacked", select the `yt-shorts-skipper/` directory
3. Reload the extension after code changes

Test on `youtube.com/shorts/` — badge shows "ON" when active.

## Architecture

**Content Script (`content.js`)** — Main logic, runs only on `/shorts/*`:
- Route guard activates/deactivates based on URL (handles SPA navigation via `yt-navigate-finish` event)
- MutationObserver on Shorts container detects navigation between videos
- 800ms debounced settle timer prevents reading stale DOM during skip animations
- Like count extraction scoped to active renderer (`ytd-reel-video-renderer[is-active]`) since YouTube pre-renders multiple Shorts
- Fallback selector chain + ARIA parsing handles DOM structure changes
- Skipping uses `ArrowDown` KeyboardEvent (YouTube's native navigation)
- Autoplay-next detects loop restart via `timeupdate` since YouTube sets `video.loop = true`

**Background Script (`background.js`)** — Badge state management per tab

**Options (`options.html/js`)** — Threshold and autoplay toggle stored in `chrome.storage.sync`

## Key Constants

- `DEFAULT_THRESHOLD`: 1000 likes
- `MAX_CONSECUTIVE_SKIPS`: 20 (prevents infinite loops)
- `LIKE_COUNT_SETTLE_DELAY`: 800ms (debounce before checking)
- `LIKE_COUNT_MAX_WAIT`: 4000ms (timeout for like count polling)
