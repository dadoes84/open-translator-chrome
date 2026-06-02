(function () {
  'use strict';

  // ── State ──────────────────────────────────────────
  const cache = new Map();        // original text → translated text
  let isTranslating = false;
  let isTranslated = false;
  let nextId = 0;

  // Tags whose text content should never be translated
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE',
    'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'SVG', 'MATH', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO',
  ]);

  // Block-level tags — text nodes under the same block ancestor are
  // grouped into one translation unit so sentences with inline elements
  // (links, emphasis) are translated as a whole.
  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'MAIN',
    'LI', 'UL', 'OL', 'DL', 'DT', 'DD',
    'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION',
    'TABLE', 'TR', 'TD', 'TH', 'THEAD', 'TBODY', 'TFOOT',
    'FORM', 'FIELDSET', 'DETAILS', 'SUMMARY',
    'BODY', 'HTML',
  ]);

  // ── Message listener ──────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'translate') {
      handleTranslate(message.settings);
    } else if (message.action === 'setDisplayMode') {
      setDisplayMode(message.displayMode);
    } else if (message.action === 'getStatus') {
      sendResponse({ isTranslating, isTranslated });
    } else if (message.action === 'cancelTranslation') {
      cancelTranslation();
    }
    // No async sendResponse needed for fire-and-forget actions
  });

  // ── Display mode ──────────────────────────────────
  function setDisplayMode(mode) {
    if (mode === 'translation-only') {
      document.documentElement.classList.add('tr-hide-original');
    } else {
      document.documentElement.classList.remove('tr-hide-original');
    }
  }

  // ── Main translation handler ──────────────────────
  async function handleTranslate(settings) {
    if (isTranslating) return;

    if (isTranslated) {
      // Already translated on this page — just sync display mode
      setDisplayMode(settings.displayMode);
      return;
    }

    isTranslating = true;
    try {
      // Guard: body may not exist (e.g. XML docs, images)
      if (!document.body) {
        console.log('[Open Translator] No document body');
        return;
      }

      // Phase 1: Walk DOM, collect text segments
      const segments = extractTextSegments();
      if (segments.length === 0) {
        console.log('[Open Translator] No translatable text found');
        return;
      }

      // Phase 2: Inject cached translations immediately;
      // collect uncached for API batch
      const uncached = [];
      const uncachedIndices = [];

      for (let i = 0; i < segments.length; i++) {
        const text = segments[i].text;
        if (cache.has(text)) {
          injectTranslation(segments[i], cache.get(text), settings);
        } else {
          uncached.push(text);
          uncachedIndices.push(i);
        }
      }

      // Phase 3: Batch-translate uncached
      if (uncached.length > 0) {
        const settingsForApi = {
          sourceLang: settings.sourceLang,
          targetLang: settings.targetLang,
          translationColor: settings.translationColor,
          translationBgColor: settings.translationBgColor,
          translationColorEnabled: settings.translationColorEnabled,
          translationBgColorEnabled: settings.translationBgColorEnabled,
        };
        const translations = await translateViaBackground(uncached, settingsForApi);
        for (let j = 0; j < translations.length; j++) {
          const idx = uncachedIndices[j];
          const text = uncached[j];
          const translated = translations[j];
          cache.set(text, translated);
          injectTranslation(segments[idx], translated, settingsForApi);
        }
      }

      // Apply display mode only AFTER all translations are in place
      setDisplayMode(settings.displayMode);

      isTranslated = true;
      document.documentElement.classList.add('tr-translated');

      // Persist cache to storage.local so it survives tab switches
      // (same origin content script keeps its JS context across tab switches,
      //  but persisting to storage is extra safety)
      persistCache();
    } catch (err) {
      console.error('[Open Translator] Translation failed:', err);
    } finally {
      isTranslating = false;
    }
  }

  // ── Block ancestor helper ──────────────────────────
  function getBlockAncestor(node) {
    let el = node.parentElement;
    while (el) {
      if (BLOCK_TAGS.has(el.tagName)) return el;
      el = el.parentElement;
    }
    return document.body;
  }

  function groupTextNodes(textNodes) {
    const groups = [];
    for (const node of textNodes) {
      const block = getBlockAncestor(node);
      if (groups.length > 0) {
        const last = groups[groups.length - 1];
        if (last.block === block) {
          last.text += node.textContent;
          last.nodes.push(node);
          continue;
        }
      }
      groups.push({ block, text: node.textContent, nodes: [node] });
    }
    return groups;
  }

  // ── Text extraction ───────────────────────────────
  function extractTextSegments() {
    const segments = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const text = node.textContent;
          // Skip empty / whitespace-only text nodes
          if (!text || !text.trim()) return NodeFilter.FILTER_REJECT;

          // Skip if any ancestor is blacklisted
          let el = node.parentElement;
          while (el) {
            if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
            if (el.getAttribute && el.getAttribute('translate') === 'no') {
              return NodeFilter.FILTER_REJECT;
            }
            el = el.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    // Collect text nodes first (DOM mutation during walk is unsafe)
    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    // Group consecutive text nodes that share the same block-level ancestor.
    // This prevents sentences split by inline elements (<a>, <strong>, etc.)
    // from being translated as independent fragments.
    const groups = groupTextNodes(textNodes);

    // Replace the first node of each group; remove the rest
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      const id = nextId++;

      const origSpan = document.createElement('span');
      origSpan.className = 'tr-orig';
      origSpan.dataset.trId = String(id);
      origSpan.textContent = group.text;

      const loadingSpan = document.createElement('span');
      loadingSpan.className = 'tr-loading';
      loadingSpan.dataset.trId = String(id);

      const firstNode = group.nodes[0];
      try {
        firstNode.replaceWith(origSpan, loadingSpan);
      } catch (_) {
        continue;
      }

      // Remove remaining text nodes in the group
      for (let n = 1; n < group.nodes.length; n++) {
        try { group.nodes[n].remove(); } catch (_) { /* already gone */ }
      }

      segments.push({ id, text: group.text, loadingSpan });
    }

    return segments;
  }

  // ── Inject translation into DOM ───────────────────
  function injectTranslation(segment, translatedText, settings) {
    const loadingSpan = segment.loadingSpan;
    if (!loadingSpan || !loadingSpan.parentNode) return; // already replaced

    const transSpan = document.createElement('span');
    transSpan.className = 'tr-trans';
    transSpan.dataset.trId = String(segment.id);
    transSpan.textContent = translatedText;

    // Apply custom styles only if enabled by user
    if (settings) {
      if (settings.translationColorEnabled && settings.translationColor) {
        transSpan.style.color = settings.translationColor;
      }
      if (settings.translationBgColorEnabled && settings.translationBgColor) {
        transSpan.style.backgroundColor = settings.translationBgColor;
      }
    }

    loadingSpan.replaceWith(transSpan);
  }

  // ── Background communication ──────────────────────
  function translateViaBackground(texts, settings) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'translateBatch', texts, settings },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.translations) {
            resolve(response.translations);
          } else if (response && response.error) {
            reject(new Error(response.error));
          } else {
            reject(new Error('Unknown response from background'));
          }
        }
      );
    });
  }

  // ── Cancel / restore ──────────────────────────────
  function cancelTranslation() {
    restoreOriginalDOM();
  }

  function restoreOriginalDOM() {
    // Remove translation and loading spans
    document.querySelectorAll('.tr-trans').forEach((el) => el.remove());
    document.querySelectorAll('.tr-loading').forEach((el) => el.remove());

    // Replace orig spans back with plain text nodes
    document.querySelectorAll('.tr-orig').forEach((el) => {
      const textNode = document.createTextNode(el.textContent);
      el.replaceWith(textNode);
    });

    // Clean up page-level classes
    document.documentElement.classList.remove('tr-hide-original', 'tr-translated');

    // Reset state
    cache.clear();
    isTranslating = false;
    isTranslated = false;
    nextId = 0;
  }

  // ── Cache persistence ─────────────────────────────
  async function persistCache() {
    // Convert Map to plain object for storage
    const obj = {};
    for (const [key, val] of cache) {
      // Use a simple hash as key to avoid storing full text in sync
      // But local storage has a 5MB+ limit per extension, so storing
      // a few thousand translations is fine
      obj[hashCode(key)] = val;
    }
    try {
      await TrStorage.localSet({ translationCache: obj });
    } catch (_) { /* non-critical */ }
  }

  // Simple string hash (djb2)
  function hashCode(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit int
    }
    return String(Math.abs(hash));
  }

  // ── Restore cache on load ─────────────────────────
  (async function restoreCache() {
    try {
      const { translationCache } = await TrStorage.localGet('translationCache');
      if (translationCache && typeof translationCache === 'object') {
        // We only restore the reverse mapping for lookup.
        // Since we use hash keys, we'd need original texts to rebuild the cache.
        // For v1, the in-memory cache (per tab) is sufficient.
        // The persisted cache can be enhanced later.
      }
    } catch (_) { /* ignore */ }
  })();
})();
