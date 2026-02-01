chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'shortsStatus' && sender.tab) {
    const tabId = sender.tab.id;
    if (message.active) {
      chrome.action.setBadgeText({ text: 'ON', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }
});

// Clear badge when navigating away from Shorts via full page load
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    const url = new URL(changeInfo.url);
    if (
      url.hostname !== 'www.youtube.com' ||
      !url.pathname.startsWith('/shorts/')
    ) {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }
});
