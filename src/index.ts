// YouTube Transcript Sync - Roam Research Extension
// Fetches YouTube transcripts using Supadata API and inserts them into the user's graph

import React from "react";

// Type declarations for Roam Alpha API
declare global {
  interface Window {
    roamAlphaAPI: {
      q: (query: string) => any[][];
      pull: (pattern: string, eid: [string, string]) => any;
      createBlock: (params: {
        location: { "parent-uid": string; order: number };
        block: { uid?: string; string: string };
      }) => Promise<void>;
      ui: {
        getFocusedBlock: () => { "block-uid": string } | null;
      };
    };
    YTSObserver?: MutationObserver;
  }
}

interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

/**
 * Convert milliseconds to timestamp format (mm:ss or hh:mm:ss)
 * @param {number} ms - Offset in milliseconds
 * @returns {string} Formatted timestamp
 */
function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (num) => String(num).padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Extract YouTube URL from text
 * Supports youtube.com and youtu.be formats
 * Also handles Markdown link format [text](url) and Roam alias format {{alias: [[page]] url}}
 * @param {string} text - Text to search for YouTube URL
 * @returns {string|null} YouTube URL or null if not found
 */
function extractYouTubeUrl(text) {
  if (!text) return null;

  // First, try to extract URL from Markdown link format [text](url)
  const markdownLinkPattern = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let mdMatch;
  while ((mdMatch = markdownLinkPattern.exec(text)) !== null) {
    const url = mdMatch[2];
    if (isYouTubeUrl(url)) {
      return cleanYouTubeUrl(url);
    }
  }

  // Match youtube.com/watch?v=, youtube.com/embed/, youtu.be/, youtube.com/shorts/
  // Updated patterns to handle various text contexts (including after ] or other chars)
  const patterns = [
    /https?:\/\/(?:www\.)?youtube\.com\/watch\?[^\s\])\[<>]*v=[\w-]+[^\s\])\[<>]*/gi,
    /https?:\/\/(?:www\.)?youtube\.com\/embed\/[\w-]+[^\s\])\[<>]*/gi,
    /https?:\/\/(?:www\.)?youtube\.com\/shorts\/[\w-]+[^\s\])\[<>]*/gi,
    /https?:\/\/youtu\.be\/[\w-]+[^\s\])\[<>]*/gi,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return cleanYouTubeUrl(match[0]);
    }
  }

  return null;
}

/**
 * Check if a URL is a YouTube URL
 * @param {string} url - URL to check
 * @returns {boolean} True if YouTube URL
 */
function isYouTubeUrl(url) {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

/**
 * Clean YouTube URL by removing trailing characters that might have been captured
 * @param {string} url - URL to clean
 * @returns {string} Cleaned URL
 */
function cleanYouTubeUrl(url) {
  // Remove trailing punctuation or brackets that might have been captured
  return url.replace(/[)\]}>.,;:!?]+$/, '');
}

/**
 * Get block info by UID
 * @param {string} uid - Block UID
 * @returns {Object|null} Block info with string and parents
 */
function getBlockInfo(uid) {
  // Try pull API first (more reliable)
  try {
    const pullResult = window.roamAlphaAPI.pull(
      "[:block/string :block/uid {:block/parents [:block/uid :block/string]}]",
      [":block/uid", uid]
    );
    if (pullResult) {
      console.log("[YTS Debug] Pull result for", uid, ":", JSON.stringify(pullResult));
      return pullResult;
    }
  } catch (e) {
    console.log("[YTS Debug] Pull API failed, trying query:", e);
  }

  // Fallback to query
  const result = window.roamAlphaAPI.q(`
    [:find (pull ?b [:block/string :block/uid {:block/parents [:block/uid :block/string]}])
     :where [?b :block/uid "${uid}"]]
  `);

  console.log("[YTS Debug] Query result for", uid, ":", JSON.stringify(result));

  if (result && result.length > 0 && result[0][0]) {
    return result[0][0];
  }
  return null;
}

/**
 * Recursively search upward for a YouTube URL
 * @param {string} blockUid - Starting block UID
 * @returns {{url: string, blockUid: string}|null} YouTube URL and block UID, or null if not found
 */
function findYouTubeUrl(blockUid) {
  const blockInfo = getBlockInfo(blockUid);

  if (!blockInfo) return null;

  // Check current block
  const url = extractYouTubeUrl(blockInfo[":block/string"]);
  if (url) return { url, blockUid };

  // Traverse up to parents
  const parents = blockInfo[":block/parents"];
  if (parents && parents.length > 0) {
    // Parents are ordered from closest to furthest ancestor
    // We need to check immediate parent first
    for (const parent of parents.reverse()) {
      const parentUid = parent[":block/uid"];
      const parentInfo = getBlockInfo(parentUid);
      if (parentInfo) {
        const parentUrl = extractYouTubeUrl(parentInfo[":block/string"]);
        if (parentUrl) return { url: parentUrl, blockUid: parentUid };
      }
    }
  }

  return null;
}

/**
 * Fetch transcript from Supadata API
 * @param {string} videoUrl - YouTube video URL
 * @param {string} apiKey - Supadata API key
 * @returns {Promise<Array|null>} Transcript segments or null on error
 */
async function fetchTranscript(videoUrl, apiKey) {
  const endpoint = `https://api.supadata.ai/v1/youtube/transcript?url=${encodeURIComponent(videoUrl)}&text=false`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Invalid API key. Please check your Supadata API key in settings.");
      } else if (response.status === 404) {
        throw new Error("Transcript not found. The video may not have captions available.");
      } else if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.");
      } else {
        throw new Error(`API request failed with status ${response.status}`);
      }
    }

    const data = await response.json();

    // Handle the response structure - it may be { content: [...] } or just [...]
    if (Array.isArray(data)) {
      return data;
    } else if (data && Array.isArray(data.content)) {
      return data.content;
    } else {
      throw new Error("Unexpected API response format");
    }
  } catch (error) {
    if (error.name === "TypeError" && error.message.includes("fetch")) {
      throw new Error("Network error. Please check your internet connection.");
    }
    throw error;
  }
}

/**
 * Generate a unique block UID
 * @returns {string} Unique UID
 */
function generateUid() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let uid = "";
  for (let i = 0; i < 9; i++) {
    uid += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return uid;
}

/**
 * Insert transcript based on selected mode
 * @param {string} youtubeBlockUid - UID of the block containing YouTube URL
 * @param {Array} segments - Transcript segments
 * @param {string} mode - Insertion mode
 */
async function insertTranscript(youtubeBlockUid, segments, mode) {
  // Insert directly as children of the YouTube block
  const parentUid = youtubeBlockUid;

  if (mode === "Nested Blocks") {
    // Create container block as first child
    const containerUid = generateUid();
    await window.roamAlphaAPI.createBlock({
      location: {
        "parent-uid": parentUid,
        order: 0,
      },
      block: {
        uid: containerUid,
        string: "**Transcript**",
      },
    });

    // Create child blocks for each segment with native Roam timestamp format
    // Format: "mm:ss text" - Roam natively supports this when block is under embedded video
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const timestamp = formatTimestamp(segment.offset);
      const text = `${timestamp} ${segment.text}`;

      await window.roamAlphaAPI.createBlock({
        location: {
          "parent-uid": containerUid,
          order: i,
        },
        block: {
          string: text,
        },
      });
    }
  } else if (mode === "Single Block (Soft Line Breaks)") {
    // Create single block with soft line breaks
    const lines = segments.map((segment) => {
      const timestamp = formatTimestamp(segment.offset);
      return `**${timestamp}** ${segment.text}`;
    });

    const content = lines.join("\n");

    await window.roamAlphaAPI.createBlock({
      location: {
        "parent-uid": parentUid,
        order: 0,
      },
      block: {
        string: content,
      },
    });
  } else if (mode === "Code Block") {
    // Create code block (plain text, no language specifier)
    // Note: Code blocks in Roam don't support clickable timestamps
    const lines = segments.map((segment) => {
      const timestamp = formatTimestamp(segment.offset);
      return `[${timestamp}] ${segment.text}`;
    });

    // Join with double newlines for blank lines between entries
    const content = "```plain text\n" + lines.join("\n\n") + "\n```";

    await window.roamAlphaAPI.createBlock({
      location: {
        "parent-uid": parentUid,
        order: 0,
      },
      block: {
        string: content,
      },
    });
  }
}

/**
 * Get currently focused block UID
 * @returns {string|null} Focused block UID
 */
function getFocusedBlockUid() {
  // Try to get from Roam's focus state
  const focusedBlock = window.roamAlphaAPI.ui.getFocusedBlock();
  if (focusedBlock && focusedBlock["block-uid"]) {
    return focusedBlock["block-uid"];
  }

  // Fallback: try to get from DOM
  const activeElement = document.activeElement;
  if (activeElement) {
    const blockElement = activeElement.closest(".rm-block__input");
    if (blockElement) {
      const blockContainer = blockElement.closest(".roam-block-container");
      if (blockContainer) {
        const blockUid = blockContainer.querySelector("[id^='block-input-']");
        if (blockUid) {
          const match = blockUid.id.match(/block-input-(.+)/);
          if (match) return match[1];
        }
      }
    }
  }

  return null;
}

/**
 * Main command handler
 * @param {Object} extensionAPI - Roam extension API
 */
async function importYoutubeTranscript(extensionAPI) {
  // Get API key from settings
  const apiKey = extensionAPI.settings.get("supadata_api_key");
  if (!apiKey) {
    // Open Roam settings panel directly to the extension settings
    extensionAPI.settings.panel.open();
    alert("Please set your Supadata API key in the extension settings.\n\nGet your API key at: https://supadata.ai");
    return;
  }

  // Get insertion mode from settings
  const insertMode = extensionAPI.settings.get("insert_mode") || "Nested Blocks";

  // Get focused block
  const focusedBlockUid = getFocusedBlockUid();
  if (!focusedBlockUid) {
    alert("Please click on a block to focus it before running this command.\n\n(Tip: Click inside the block text, not just hover over it)");
    return;
  }

  // Find YouTube URL (recursive upward search)
  const youtubeResult = findYouTubeUrl(focusedBlockUid);
  if (!youtubeResult) {
    // Debug: show what content was found in the block
    const blockInfo = getBlockInfo(focusedBlockUid);
    const blockContent = blockInfo ? blockInfo[":block/string"] : "N/A";
    console.log("[YTS Debug] Focused block UID:", focusedBlockUid);
    console.log("[YTS Debug] Block content:", blockContent);
    alert(`No YouTube URL found in the current block or any ancestor blocks.\n\nCurrent block content: "${blockContent?.substring(0, 100) || 'empty'}"`);
    return;
  }

  const { url: videoUrl, blockUid: youtubeBlockUid } = youtubeResult;

  // Show loading indicator
  const loadingMessage = document.createElement("div");
  loadingMessage.id = "yts-loading";
  loadingMessage.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 20px 40px;
    border-radius: 8px;
    z-index: 10000;
    font-size: 14px;
  `;
  loadingMessage.textContent = "Fetching transcript...";
  document.body.appendChild(loadingMessage);

  try {
    // Fetch transcript
    const segments = await fetchTranscript(videoUrl, apiKey);

    if (!segments || segments.length === 0) {
      alert("No transcript data found for this video.");
      return;
    }

    // Insert transcript as child of the YouTube block
    await insertTranscript(youtubeBlockUid, segments, insertMode);

  } catch (error) {
    alert(`Error: ${error.message}`);
  } finally {
    // Remove loading indicator
    const loader = document.getElementById("yts-loading");
    if (loader) {
      loader.remove();
    }
  }
}

// Timestamp pattern: matches mm:ss or hh:mm:ss at the start of text (with optional bold markers)
const TIMESTAMP_PATTERN = /^(?:\*\*)?((?:\d+:)?\d+:\d{2})(?:\*\*)?\s/;
// Pattern to find all timestamps in a block (including bold format used in Single Block mode)
const ALL_TIMESTAMPS_PATTERN = /(?:\*\*)?((?:\d+:)?\d+:\d{2})(?:\*\*)?(?=\s)/g;

/**
 * Parse timestamp string to seconds
 * @param {string} timestamp - Timestamp in format mm:ss or hh:mm:ss
 * @returns {number} Total seconds
 */
function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return parts[0] * 60 + parts[1];
}

/**
 * Find the YouTube iframe closest to a block element
 * @param {Element} blockElement - The block element
 * @returns {HTMLIFrameElement|null} The YouTube iframe or null
 */
function findYouTubePlayer(blockElement: Element): HTMLIFrameElement | null {
  // Walk up the DOM to find parent blocks and look for YouTube iframe
  let current: Element | null = blockElement;

  while (current) {
    const container = current.closest('.roam-block-container');
    if (!container) break;

    // Check parent container for iframe
    const parentContainer = container.parentElement?.closest('.roam-block-container');
    if (parentContainer) {
      const iframe = parentContainer.querySelector('iframe[src*="youtube.com"], iframe[src*="youtu.be"]') as HTMLIFrameElement;
      if (iframe) return iframe;
    }

    current = parentContainer || null;
  }

  // Fallback: find any YouTube iframe on the page (closest one visible)
  const allIframes = document.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtu.be"]') as NodeListOf<HTMLIFrameElement>;
  if (allIframes.length > 0) {
    return allIframes[0];
  }

  return null;
}

/**
 * Seek YouTube video to specified time
 * @param {HTMLIFrameElement} iframe - YouTube iframe element
 * @param {number} seconds - Time in seconds to seek to
 */
function seekYouTubeVideo(iframe: HTMLIFrameElement, seconds: number): void {
  // Use YouTube iframe API postMessage
  const src = iframe.src;

  // Ensure enablejsapi=1 is in the URL
  if (!src.includes('enablejsapi=1')) {
    const separator = src.includes('?') ? '&' : '?';
    iframe.src = `${src}${separator}enablejsapi=1`;
  }

  // Send seekTo command via postMessage
  iframe.contentWindow?.postMessage(JSON.stringify({
    event: 'command',
    func: 'seekTo',
    args: [seconds, true]
  }), '*');

  // Also try to play
  iframe.contentWindow?.postMessage(JSON.stringify({
    event: 'command',
    func: 'playVideo',
    args: []
  }), '*');
}

/**
 * Make timestamps clickable
 */
function addTimestampButtons(): void {
  // Find all roam block containers and check their content
  const blockContainers = document.querySelectorAll('.roam-block-container');

  blockContainers.forEach((container) => {
    // Find the block content - try multiple selectors
    const blockContent = container.querySelector('.rm-block-text, .rm-block__input > span') as HTMLElement;
    if (!blockContent) return;

    const text = blockContent.textContent || '';

    // Find all timestamps in the text
    const timestampMatches: Array<{timestamp: string, seconds: number}> = [];
    let match;
    const patternCopy = new RegExp(ALL_TIMESTAMPS_PATTERN.source, 'g');
    while ((match = patternCopy.exec(text)) !== null) {
      const timestamp = match[1];
      // Skip if this timestamp was already processed
      if (!timestampMatches.find(t => t.timestamp === timestamp)) {
        timestampMatches.push({
          timestamp,
          seconds: parseTimestamp(timestamp)
        });
      }
    }

    if (timestampMatches.length === 0) return;

    // Process each timestamp
    for (const {timestamp, seconds} of timestampMatches) {
      // Find text nodes containing this timestamp that haven't been processed
      const walker = document.createTreeWalker(blockContent, NodeFilter.SHOW_TEXT);
      let node: Text | null;
      const nodesToProcess: Array<{node: Text, idx: number}> = [];

      while ((node = walker.nextNode() as Text)) {
        const nodeText = node.textContent || '';
        let searchIdx = 0;
        let idx;
        while ((idx = nodeText.indexOf(timestamp, searchIdx)) !== -1) {
          // Check if parent is already a yts-timestamp span
          if (!node.parentElement?.classList.contains('yts-timestamp')) {
            nodesToProcess.push({node, idx});
          }
          searchIdx = idx + timestamp.length;
        }
      }

      // Process nodes (in reverse order to maintain correct indices)
      for (const {node, idx} of nodesToProcess.reverse()) {
        const nodeText = node.textContent || '';
        // Re-check index since DOM may have changed
        const currentIdx = nodeText.indexOf(timestamp);
        if (currentIdx === -1) continue;

        // Check if already processed
        if (node.parentElement?.classList.contains('yts-timestamp')) continue;

        // Split the text node and wrap the timestamp
        const before = nodeText.substring(0, currentIdx);
        const after = nodeText.substring(currentIdx + timestamp.length);

        // Create clickable timestamp span
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'yts-timestamp';
        timestampSpan.textContent = timestamp;
        timestampSpan.title = `Click to jump to ${timestamp}`;

        timestampSpan.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          const iframe = findYouTubePlayer(container);
          if (iframe) {
            seekYouTubeVideo(iframe, seconds);
          } else {
            console.log('[YTS] No YouTube player found');
          }
        });

        // Replace the text node with the new structure
        const fragment = document.createDocumentFragment();
        if (before) fragment.appendChild(document.createTextNode(before));
        fragment.appendChild(timestampSpan);
        if (after) fragment.appendChild(document.createTextNode(after));

        node.parentNode?.replaceChild(fragment, node);
      }
    }
  });
}

/**
 * Initialize timestamp button observer
 */
function initTimestampObserver(): void {
  // Add CSS styles
  const style = document.createElement('style');
  style.id = 'yts-styles';
  style.textContent = `
    .yts-timestamp {
      color: #137cbd;
      cursor: pointer;
      text-decoration: underline;
      text-decoration-style: dotted;
    }
    .yts-timestamp:hover {
      color: #0d5a8c;
      text-decoration-style: solid;
    }
  `;
  document.head.appendChild(style);

  // Initial scan
  addTimestampButtons();

  // Set up mutation observer to watch for new blocks
  const observer = new MutationObserver((mutations) => {
    let shouldUpdate = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0 || mutation.type === 'characterData') {
        shouldUpdate = true;
        break;
      }
    }
    if (shouldUpdate) {
      // Debounce updates
      setTimeout(addTimestampButtons, 100);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Store observer for cleanup
  window.YTSObserver = observer;
}

/**
 * Cleanup timestamp observer
 */
function cleanupTimestampObserver(): void {
  // Remove observer
  if (window.YTSObserver) {
    window.YTSObserver.disconnect();
    delete window.YTSObserver;
  }

  // Remove styles
  const style = document.getElementById('yts-styles');
  if (style) style.remove();

  // Remove all timestamp spans (note: this will leave the text, page refresh recommended)
  document.querySelectorAll('.yts-timestamp').forEach(span => {
    const text = span.textContent || '';
    span.replaceWith(document.createTextNode(text));
  });
}

/**
 * Extension onload handler
 * @param {Object} param0 - Extension context with extensionAPI
 */
function onload({ extensionAPI }) {
  // Configure settings panel
  extensionAPI.settings.panel.create({
    tabTitle: "YouTube Transcript Sync",
    settings: [
      {
        id: "supadata_api_key",
        name: "Supadata API Key",
        description: React.createElement(
          React.Fragment,
          {},
          "Get your key from ",
          React.createElement(
            "a",
            {
              href: "https://supadata.ai",
              target: "_blank",
              rel: "noopener noreferrer",
            },
            "supadata.ai"
          ),
          ". Free tier includes 100 credits/month - enough for daily use."
        ),
        action: {
          type: "input",
          placeholder: "Enter your API key",
        },
      },
      {
        id: "insert_mode",
        name: "Transcript Format",
        description: "Choose how the transcript should be inserted",
        action: {
          type: "select",
          items: [
            "Nested Blocks",
            "Single Block (Soft Line Breaks)",
            "Code Block",
          ],
        },
      },
    ],
  });

  // Register command
  extensionAPI.ui.commandPalette.addCommand({
    label: "Import Youtube Transcript",
    callback: () => importYoutubeTranscript(extensionAPI),
  });

  // Initialize timestamp click functionality
  initTimestampObserver();

  console.log("YouTube Transcript Sync extension loaded");
}

/**
 * Extension onunload handler
 */
function onunload() {
  // Cleanup timestamp observer and buttons
  cleanupTimestampObserver();

  // Cleanup: remove loading indicator if present
  const loader = document.getElementById("yts-loading");
  if (loader) {
    loader.remove();
  }

  console.log("YouTube Transcript Sync extension unloaded");
}

export default {
  onload,
  onunload,
};
