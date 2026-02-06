const ICONS_GREEN = {
  16: 'icons/icon16.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
};

const ICONS_GRAY = {
  16: 'icons/icon16-gray.png',
  48: 'icons/icon48-gray.png',
  128: 'icons/icon128-gray.png',
};

function setIconState(tabId, state) {
  // state: 'gray' | 'green' | 'active'
  const icons = state === 'gray' ? ICONS_GRAY : ICONS_GREEN;
  chrome.action.setIcon({ path: icons, tabId });

  if (state === 'active') {
    chrome.action.setBadgeText({ text: 'ON', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId });
  }
}

function getUrlState(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'www.youtube.com') {
      return parsed.pathname.startsWith('/shorts/') ? 'shorts' : 'youtube';
    }
  } catch {}
  return 'other';
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'shortsStatus' && sender.tab) {
    const tabId = sender.tab.id;
    if (message.active) {
      setIconState(tabId, 'active');
    } else {
      // Content script says not on shorts, check if still on YouTube
      const state = getUrlState(sender.tab.url);
      setIconState(tabId, state === 'youtube' ? 'green' : 'gray');
    }
  }
});

// Track tabs where we've already injected the content script
const injectedTabs = new Set();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Update icon on URL change
  if (changeInfo.url) {
    const state = getUrlState(changeInfo.url);

    if (state === 'shorts') {
      setIconState(tabId, 'active');
      // Inject content script if not already present (handles race condition on initial load)
      if (!injectedTabs.has(tabId)) {
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        }).then(() => {
          injectedTabs.add(tabId);
        }).catch(() => {
          // Script may already be running, that's fine
        });
      }
    } else if (state === 'youtube') {
      setIconState(tabId, 'green');
    } else {
      setIconState(tabId, 'gray');
    }
  }

  // Also update icon when page finishes loading (for initial tab state)
  if (changeInfo.status === 'complete' && tab.url) {
    const state = getUrlState(tab.url);
    if (state === 'shorts') {
      setIconState(tabId, 'active');
    } else if (state === 'youtube') {
      setIconState(tabId, 'green');
    } else {
      setIconState(tabId, 'gray');
    }
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});
