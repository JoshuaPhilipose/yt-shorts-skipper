(function () {
  'use strict';

  const DEFAULT_THRESHOLD = 1000;
  const thresholdInput = document.getElementById('threshold');
  const saveBtn = document.getElementById('save');
  const statusEl = document.getElementById('status');

  // Load saved value
  chrome.storage.sync.get({ threshold: DEFAULT_THRESHOLD }, (result) => {
    thresholdInput.value = result.threshold;
  });

  saveBtn.addEventListener('click', () => {
    const value = parseInt(thresholdInput.value, 10);
    if (isNaN(value) || value < 0) {
      statusEl.textContent = 'Please enter a valid number.';
      statusEl.style.color = '#f44336';
      return;
    }
    chrome.storage.sync.set({ threshold: value }, () => {
      statusEl.textContent = 'Saved!';
      statusEl.style.color = '#4CAF50';
      setTimeout(() => {
        statusEl.textContent = '';
      }, 2000);
    });
  });
})();
