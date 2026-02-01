(function () {
  'use strict';

  const TAG = '[YT Shorts Skipper]';
  const DEFAULT_THRESHOLD = 1000;
  const MAX_CONSECUTIVE_SKIPS = 20;
  const LIKE_COUNT_POLL_INTERVAL = 400;
  const LIKE_COUNT_MAX_WAIT = 4000;
  const LIKE_COUNT_SETTLE_DELAY = 800; // wait before first poll to let DOM update
  const ACTIVATE_RETRY_INTERVAL = 500;
  const ACTIVATE_MAX_RETRIES = 10;

  let observer = null;
  let lastVideoId = null;
  let consecutiveSkips = 0;
  let threshold = DEFAULT_THRESHOLD;
  let pendingCheck = null; // timeout ID for the current scheduled check

  console.log(TAG, 'Content script loaded. URL:', location.href);

  // --- Settings ---

  function loadSettings() {
    chrome.storage.sync.get({ threshold: DEFAULT_THRESHOLD }, (result) => {
      threshold = result.threshold;
      console.log(TAG, 'Threshold loaded:', threshold);
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.threshold) {
      threshold = changes.threshold.newValue;
      console.log(TAG, 'Threshold updated:', threshold);
    }
  });

  loadSettings();

  // --- Route Guard ---

  function isOnShorts() {
    return location.pathname.startsWith('/shorts/');
  }

  function getVideoId() {
    const match = location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  function activate() {
    if (observer) return;
    console.log(TAG, 'Activating...');
    tryActivate(0);
  }

  function tryActivate(attempt) {
    if (observer) return;
    if (!isOnShorts()) return;

    const containerSelectors = [
      'ytd-shorts',
      'ytd-reel-video-renderer',
      '#shorts-container',
      'ytd-shorts-video-player-renderer',
    ];

    let target = null;
    for (const sel of containerSelectors) {
      target = document.querySelector(sel);
      if (target) {
        console.log(TAG, 'Container found:', sel);
        break;
      }
    }

    if (!target) {
      if (attempt < ACTIVATE_MAX_RETRIES) {
        console.log(TAG, 'Container not found, retry', attempt + 1, '/', ACTIVATE_MAX_RETRIES);
        setTimeout(() => tryActivate(attempt + 1), ACTIVATE_RETRY_INTERVAL);
      } else {
        console.warn(TAG, 'No container found after retries.');
        dumpPageDiagnostics();
      }
      return;
    }

    console.log(TAG, 'Observer started on', target.tagName);
    observer = new MutationObserver(onMutation);
    observer.observe(target, { childList: true, subtree: true });
    scheduleCheck();
    notifyBackground(true);
  }

  function deactivate() {
    if (observer) {
      console.log(TAG, 'Deactivating.');
      observer.disconnect();
      observer = null;
    }
    cancelCheck();
    lastVideoId = null;
    consecutiveSkips = 0;
    notifyBackground(false);
  }

  function onRouteChange() {
    console.log(TAG, 'Route change:', location.pathname);
    if (isOnShorts()) {
      activate();
    } else {
      deactivate();
    }
  }

  // --- Mutation Handling ---

  function onMutation() {
    // A mutation happened — schedule a check after settle delay.
    // If a check is already pending, restart the timer (debounce).
    scheduleCheck();
  }

  /**
   * Schedule a like-count check after SETTLE_DELAY. Restarts on each call
   * so rapid mutations (from skip animations) collapse into one check
   * after things calm down.
   */
  function scheduleCheck() {
    cancelCheck();
    pendingCheck = setTimeout(() => {
      pendingCheck = null;
      processCurrentShort();
    }, LIKE_COUNT_SETTLE_DELAY);
  }

  function cancelCheck() {
    if (pendingCheck) {
      clearTimeout(pendingCheck);
      pendingCheck = null;
    }
  }

  // --- Core Logic ---

  function processCurrentShort() {
    if (!isOnShorts()) return;

    const videoId = getVideoId();
    if (!videoId) return;
    if (videoId === lastVideoId) return;

    console.log(TAG, '--- Processing short:', videoId);
    lastVideoId = videoId;

    pollLikeCount(videoId, 0);
  }

  function pollLikeCount(videoId, elapsed) {
    // Bail if we've navigated away
    if (!isOnShorts() || getVideoId() !== videoId) {
      console.log(TAG, 'Video changed during poll, aborting.');
      return;
    }

    const likeCount = getLikeCount();

    if (likeCount !== null) {
      console.log(TAG, 'Like count for', videoId, ':', likeCount);
      decideFate(videoId, likeCount);
      return;
    }

    if (elapsed >= LIKE_COUNT_MAX_WAIT) {
      console.warn(TAG, 'Like count poll timed out for', videoId, '— treating as 0 (skip)');
      dumpLikeButtonDiagnostics();
      decideFate(videoId, 0);
      return;
    }

    setTimeout(() => {
      pollLikeCount(videoId, elapsed + LIKE_COUNT_POLL_INTERVAL);
    }, LIKE_COUNT_POLL_INTERVAL);
  }

  function decideFate(videoId, likeCount) {
    if (likeCount < threshold) {
      if (consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
        console.log(TAG, 'Skip cap reached (' + MAX_CONSECUTIVE_SKIPS + '). Stopping.');
        consecutiveSkips = 0;
        return;
      }
      consecutiveSkips++;
      console.log(TAG, 'SKIP', videoId, '(' + likeCount, '<', threshold + ')');
      skipShort();
      // After skip, scheduleCheck will be triggered by mutations.
      // The settle delay ensures we don't read stale DOM.
    } else {
      console.log(TAG, 'KEEP', videoId, '(' + likeCount, '>=', threshold + ')');
      consecutiveSkips = 0;
    }
  }

  // --- Active Renderer Detection ---

  function getActiveRenderer() {
    // Method 1: [is-active] attribute
    const active = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (active) return active;

    // Method 2: visible in viewport
    const renderers = document.querySelectorAll('ytd-reel-video-renderer');
    for (const r of renderers) {
      const rect = r.getBoundingClientRect();
      if (rect.top > -100 && rect.top < window.innerHeight / 2 && rect.height > 0) {
        return r;
      }
    }

    return renderers[0] || null;
  }

  // --- Like Count Extraction ---

  function getLikeCount() {
    const renderer = getActiveRenderer();

    // Strategy 1: scoped to active renderer
    if (renderer) {
      const count = extractLikeFromElement(renderer);
      if (count !== null) return count;
    }

    // Strategy 2: whole document fallback
    return extractLikeFromElement(document);
  }

  function extractLikeFromElement(root) {
    const selectors = [
      '#like-button yt-formatted-string',
      '#like-button .yt-core-attributed-string',
      '#like-button > yt-button-shape > label > .yt-spec-button-shape-next__button-text-content',
      '#like-button span[role="text"]',
      'like-button-view-model .yt-core-attributed-string',
      '#like-button yt-attributed-string span',
      '[id="like-button"] yt-formatted-string',
      // Shorts-specific action bar selectors
      'ytd-reel-player-overlay-renderer #like-button yt-formatted-string',
      '#shorts-action-bar #like-button yt-formatted-string',
      'shorts-action-bar-renderer #like-button span',
    ];

    let likeButtonFound = false;

    for (const selector of selectors) {
      const els = root.querySelectorAll(selector);
      for (const el of els) {
        likeButtonFound = true;
        const text = el.textContent.trim();
        // Empty text or "Like" with no number = 0 likes
        if (text.length === 0 || /^like$/i.test(text)) {
          console.log(TAG, 'Like button found but no count (text:', JSON.stringify(text), ') — 0 likes');
          return 0;
        }
        const parsed = parseAbbreviated(text);
        if (!isNaN(parsed) && parsed >= 0) {
          console.log(TAG, 'Found via:', selector, '| text:', JSON.stringify(text), '| =', parsed);
          return parsed;
        }
      }
    }

    // If we found a like button element but couldn't parse a number, it's 0
    if (likeButtonFound) return 0;

    // ARIA fallback: buttons with "like" in aria-label that contain a number
    const ariaBtns = root.querySelectorAll('button[aria-label*="like" i]');
    for (const btn of ariaBtns) {
      const label = btn.getAttribute('aria-label') || '';
      const numMatch = label.match(/([\d,]+\.?\d*)\s*([KMBkmb])?/);
      if (numMatch) {
        const numText = numMatch[1] + (numMatch[2] || '');
        const parsed = parseAbbreviated(numText);
        if (!isNaN(parsed) && parsed >= 0) {
          console.log(TAG, 'Found via ARIA:', JSON.stringify(label), '| =', parsed);
          return parsed;
        }
      }
    }

    // Any [aria-label] inside #like-button
    const a11y = root.querySelectorAll('#like-button [aria-label]');
    for (const el of a11y) {
      const label = el.getAttribute('aria-label') || '';
      const numMatch = label.match(/([\d,]+\.?\d*)\s*([KMBkmb])?/);
      if (numMatch) {
        const numText = numMatch[1] + (numMatch[2] || '');
        const parsed = parseAbbreviated(numText);
        if (!isNaN(parsed) && parsed >= 0) {
          console.log(TAG, 'Found via a11y:', JSON.stringify(label), '| =', parsed);
          return parsed;
        }
      }
    }

    return null;
  }

  function parseAbbreviated(text) {
    text = text.replace(/,/g, '').trim();
    const upper = text.toUpperCase();
    if (upper.endsWith('B')) return parseFloat(text) * 1_000_000_000;
    if (upper.endsWith('M')) return parseFloat(text) * 1_000_000;
    if (upper.endsWith('K')) return parseFloat(text) * 1_000;
    return parseInt(text, 10);
  }

  // --- Diagnostics ---

  function dumpPageDiagnostics() {
    const custom = [...new Set(
      [...document.querySelectorAll('*')]
        .map((e) => e.tagName.toLowerCase())
        .filter((t) => t.includes('-'))
    )].sort();
    console.log(TAG, 'DIAG custom elements:', custom.join(', '));
  }

  function dumpLikeButtonDiagnostics() {
    const renderer = getActiveRenderer();
    const scope = renderer || document;
    const scopeName = renderer ? ('renderer:' + renderer.tagName) : 'document';

    console.log(TAG, 'DIAG scope:', scopeName);
    console.log(TAG, 'DIAG renderer [is-active]?', renderer?.hasAttribute('is-active'));

    // Log all elements with "like" in id or aria-label
    const likeEls = scope.querySelectorAll('[id*="like" i], [aria-label*="like" i]');
    console.log(TAG, 'DIAG like-related elements:', likeEls.length);
    likeEls.forEach((el, i) => {
      console.log(TAG, 'DIAG [' + i + ']', {
        tag: el.tagName.toLowerCase(),
        id: el.id || '(none)',
        ariaLabel: el.getAttribute('aria-label'),
        textContent: el.textContent.substring(0, 120).trim(),
        childCount: el.children.length,
        outerHTML: el.outerHTML.substring(0, 200),
      });
    });

    // Also dump from full document if we scoped above
    if (renderer) {
      const docLikes = document.querySelectorAll('[id="like-button"]');
      console.log(TAG, 'DIAG #like-button elements in full document:', docLikes.length);
      docLikes.forEach((el, i) => {
        console.log(TAG, 'DIAG doc-like [' + i + ']', {
          tag: el.tagName.toLowerCase(),
          textContent: el.textContent.substring(0, 120).trim(),
          outerHTML: el.outerHTML.substring(0, 300),
        });
      });
    }
  }

  // --- Skip ---

  function skipShort() {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        bubbles: true,
      })
    );
  }

  // --- Background Communication ---

  function notifyBackground(active) {
    chrome.runtime.sendMessage({ type: 'shortsStatus', active }).catch(() => {});
  }

  // --- Init ---

  document.addEventListener('yt-navigate-finish', onRouteChange);
  onRouteChange();
})();
