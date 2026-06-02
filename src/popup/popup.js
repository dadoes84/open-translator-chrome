// Popup script — UI logic for the extension popup

const $ = (sel) => document.querySelector(sel);

// Elements
const sourceLangEl = $('#source-lang');
const targetLangEl = $('#target-lang');
const serviceEl = $('#service-select');
const toggleBtn = $('#toggle-btn');
const translateBtn = $('#translate-btn');
const settingsBtn = $('#settings-btn');

// State
let displayMode = 'bilingual';          // 'bilingual' | 'translation-only'
let pageStatus = { isTranslating: false, isTranslated: false };

// ── Init ────────────────────────────────────────────
async function init() {
  const settings = await TrStorage.getSettings();

  sourceLangEl.value = settings.sourceLang;
  targetLangEl.value = settings.targetLang;
  serviceEl.value = settings.translationService;
  displayMode = settings.displayMode;

  updateToggleButton();

  // Query active tab translation status
  pageStatus = await queryTranslationStatus();
  updateTranslateButton();

  bindEvents();
}

function updateToggleButton() {
  toggleBtn.textContent = displayMode === 'bilingual' ? '双语对照' : '仅显示译文';
}

function updateTranslateButton() {
  if (pageStatus.isTranslating) {
    translateBtn.textContent = '取消翻译 (Alt+T)';
    translateBtn.classList.add('btn-cancel');
  } else {
    translateBtn.textContent = '翻译 (Alt+T)';
    translateBtn.classList.remove('btn-cancel');
  }
}

// ── Query active tab for translation status ─────────
function queryTranslationStatus() {
  return new Promise(async (resolve) => {
    const fallback = { isTranslating: false, isTranslated: false };
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) { resolve(fallback); return; }

      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve(fallback); }
      }, 300);

      chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) { resolve(fallback); return; }
        resolve(response || fallback);
      });
    } catch (_) {
      resolve(fallback);
    }
  });
}

// ── Events ──────────────────────────────────────────
function bindEvents() {
  sourceLangEl.addEventListener('change', () =>
    TrStorage.saveSettings({ sourceLang: sourceLangEl.value }));

  targetLangEl.addEventListener('change', () =>
    TrStorage.saveSettings({ targetLang: targetLangEl.value }));

  serviceEl.addEventListener('change', () =>
    TrStorage.saveSettings({ translationService: serviceEl.value }));

  toggleBtn.addEventListener('click', () => {
    displayMode = displayMode === 'bilingual' ? 'translation-only' : 'bilingual';
    updateToggleButton();
    TrStorage.saveSettings({ displayMode });
    // Only push to page if already translated — otherwise
    // handleTranslate applies the mode after injections are done
    if (pageStatus.isTranslated) {
      sendToActiveTab({ action: 'setDisplayMode', displayMode });
    }
  });

  translateBtn.addEventListener('click', async () => {
    if (pageStatus.isTranslating) {
      // Cancel in-progress translation
      sendToActiveTab({ action: 'cancelTranslation' });
      window.close();
      return;
    }

    // Start translation
    await TrStorage.saveSettings({
      sourceLang: sourceLangEl.value,
      targetLang: targetLangEl.value,
      translationService: serviceEl.value,
      displayMode,
    });
    const settings = await TrStorage.getSettings();
    sendToActiveTab({ action: 'translate', settings });
    window.close();
  });

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

// ── Messaging ───────────────────────────────────────
// Route through background to survive popup close
function sendToActiveTab(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ── Boot ────────────────────────────────────────────
init();
