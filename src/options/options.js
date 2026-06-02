// Options page script — settings UI

const $ = (sel) => document.querySelector(sel);

// Elements
const apiKeyEl = $('#api-key');
const modelRadios = document.getElementsByName('model');
const promptEl = $('#prompt');
const colorEnabledEl = $('#color-enabled');
const transColorEl = $('#trans-color');
const bgEnabledEl = $('#bg-enabled');
const transBgEl = $('#trans-bg');
const saveBtn = $('#save-btn');
const resetBtn = $('#reset-btn');
const toastEl = $('#toast');

// ── Init ────────────────────────────────────────────
async function init() {
  const settings = await TrStorage.getSettings();

  apiKeyEl.value = settings.apiKey || '';
  promptEl.value = settings.prompt || '';

  // Model radio
  for (const radio of modelRadios) {
    if (radio.value === settings.model) radio.checked = true;
  }

  // Color toggles
  colorEnabledEl.checked = settings.translationColorEnabled;
  transColorEl.value = settings.translationColor || '#4a90d9';
  transColorEl.disabled = !settings.translationColorEnabled;

  bgEnabledEl.checked = settings.translationBgColorEnabled;
  transBgEl.value = settings.translationBgColor || '#ffff00';
  transBgEl.disabled = !settings.translationBgColorEnabled;

  bindEvents();
}

// ── Events ──────────────────────────────────────────
function bindEvents() {
  // Toggle switches enable/disable color pickers
  colorEnabledEl.addEventListener('change', () => {
    transColorEl.disabled = !colorEnabledEl.checked;
  });

  bgEnabledEl.addEventListener('change', () => {
    transBgEl.disabled = !bgEnabledEl.checked;
  });

  saveBtn.addEventListener('click', save);
  resetBtn.addEventListener('click', reset);
}

// ── Save ────────────────────────────────────────────
async function save() {
  const model = getSelectedModel();
  const settings = {
    apiKey: apiKeyEl.value.trim(),
    model,
    prompt: promptEl.value.trim(),
    translationColor: transColorEl.value,
    translationBgColor: transBgEl.value,
    translationColorEnabled: colorEnabledEl.checked,
    translationBgColorEnabled: bgEnabledEl.checked,
  };

  await TrStorage.saveSettings(settings);
  showToast('设置已保存');
}

function getSelectedModel() {
  for (const radio of modelRadios) {
    if (radio.checked) return radio.value;
  }
  return 'deepseek-chat';
}

// ── Reset ───────────────────────────────────────────
async function reset() {
  await TrStorage.resetSettings();
  const defaults = TrStorage.DEFAULTS;

  apiKeyEl.value = '';
  promptEl.value = defaults.prompt;

  for (const radio of modelRadios) {
    radio.checked = (radio.value === defaults.model);
  }

  colorEnabledEl.checked = defaults.translationColorEnabled;
  transColorEl.value = '#4a90d9';
  transColorEl.disabled = !defaults.translationColorEnabled;

  bgEnabledEl.checked = defaults.translationBgColorEnabled;
  transBgEl.value = '#ffff00';
  transBgEl.disabled = !defaults.translationBgColorEnabled;

  showToast('已恢复默认值');
}

// ── Helpers ─────────────────────────────────────────
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2000);
}

// ── Boot ────────────────────────────────────────────
init();
