// Shared storage wrapper — used by popup / options / background
// Settings that contain secrets (apiKey) go to chrome.storage.sync
// Cached translations go to chrome.storage.local

const DEFAULTS = Object.freeze({
  // API settings (sync)
  apiKey: '',
  model: 'deepseek-chat',          // 'deepseek-chat' (Flash) | 'deepseek-reasoner' (Pro)
  prompt: 'You are a translation engine. Translate the following JSON array of strings from ${sourceLang} to ${targetLang}. Return ONLY a JSON array of translated strings in the same order. Do not add any explanation, markdown, or extra text.',
  // Translation settings (sync)
  sourceLang: 'auto',
  targetLang: 'zh',
  displayMode: 'bilingual',        // 'bilingual' | 'translation-only'
  translationService: 'deepseek',  // only deepseek for now
  // Style settings (sync)
  translationColor: '',            // CSS color value, empty = inherit
  translationBgColor: '',          // CSS background-color value, empty = inherit
  translationColorEnabled: false,  // true = apply custom text color
  translationBgColorEnabled: false,// true = apply custom background color
});

// storage.sync for small, user-synced settings
function syncGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (result) => resolve(result));
  });
}

function syncSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(obj, () => resolve());
  });
}

// storage.local for larger / non-synced data (translation cache)
function localGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result));
  });
}

function localSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

// Merge stored values with defaults — callers get a complete settings object
async function getSettings() {
  const stored = await syncGet(Object.keys(DEFAULTS));
  const merged = {};
  for (const [key, def] of Object.entries(DEFAULTS)) {
    merged[key] = (stored[key] !== undefined) ? stored[key] : def;
  }
  return merged;
}

async function saveSettings(partial) {
  await syncSet(partial);
}

// Reset everything to defaults
async function resetSettings() {
  await new Promise((resolve) => chrome.storage.sync.clear(resolve));
}

// Expose for popup/options/background. In popup/options `window` exists;
// in the service worker we attach to `self` via `globalThis`.
const _global = typeof globalThis !== 'undefined' ? globalThis : self;
_global.TrStorage = {
  DEFAULTS,
  getSettings,
  saveSettings,
  resetSettings,
  syncGet,
  syncSet,
  localGet,
  localSet,
};
