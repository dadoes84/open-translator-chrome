// Background service worker — DeepSeek API proxy + Alt+T shortcut handler
importScripts('../shared/storage.js');

const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';

// ── Message handler ─────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Popup → Content script relay (survives popup close)
  if (message.action === 'translate' || message.action === 'setDisplayMode' || message.action === 'cancelTranslation') {
    relayToActiveTab(message);
    return false; // fire-and-forget
  }

  // Content script → DeepSeek API proxy
  if (message.action === 'translateBatch') {
    handleTranslateBatch(message.texts, message.settings)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }
});

// ── Relay message to active tab's content script ─────
async function relayToActiveTab(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Content script may not be ready or page not injectable
      });
    }
  } catch (_) { /* ignore */ }
}

// ── Batch translation via DeepSeek ──────────────────
async function handleTranslateBatch(texts, uiSettings) {
  if (!texts || texts.length === 0) {
    return { translations: [] };
  }

  const settings = await TrStorage.getSettings();

  if (!settings.apiKey) {
    throw new Error('请先在设置页配置 DeepSeek API Key');
  }

  const sourceLang = uiSettings.sourceLang || settings.sourceLang;
  const targetLang = uiSettings.targetLang || settings.targetLang;

  // Build system prompt with language placeholders replaced
  const systemPrompt = (settings.prompt || TrStorage.DEFAULTS.prompt)
    .replace(/\$\{sourceLang\}/g, sourceLang)
    .replace(/\$\{targetLang\}/g, targetLang);

  // Send texts as a JSON array
  const userMessage = JSON.stringify(texts);

  const body = {
    model: settings.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  };

  const response = await fetch(DEEPSEEK_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    if (response.status === 401) {
      throw new Error('API Key 无效，请在设置页检查');
    }
    if (response.status === 429) {
      throw new Error('API 请求频率过高，请稍后再试');
    }
    throw new Error(`API 请求失败 (${response.status}): ${errText}`);
  }

  const data = await response.json();

  // Extract translations from response
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('API 返回格式异常：无内容');
  }

  // Parse the JSON array from the response
  const translations = parseTranslationResponse(content, texts.length);

  if (!translations || translations.length !== texts.length) {
    throw new Error(
      `译文数量不匹配：期望 ${texts.length} 条，实际收到 ${translations ? translations.length : 0} 条`
    );
  }

  return { translations };
}

// ── Parse model response into array ─────────────────
function parseTranslationResponse(content, expectedCount) {
  // Try direct JSON parse first
  try {
    const arr = JSON.parse(content);
    if (Array.isArray(arr)) return arr;
  } catch (_) { /* fall through */ }

  // Strip markdown code fences
  let cleaned = content
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim();

  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr)) return arr;
  } catch (_) { /* fall through */ }

  // Try to extract array from within the content
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) return arr;
    } catch (_) { /* fall through */ }
  }

  return null;
}

// ── Keyboard shortcut (Alt+T) ───────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'translate') return;

  try {
    const settings = await TrStorage.getSettings();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'translate', settings })
        .catch(() => {
          // Content script may not be ready on this page
        });
    }
  } catch (err) {
    console.error('[Open Translator] Shortcut handler error:', err);
  }
});
