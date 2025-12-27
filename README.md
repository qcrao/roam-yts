# YouTube Transcript Sync

A Roam Research extension that fetches YouTube video transcripts and inserts them into your graph.

![Demo](https://github.com/qcrao/roam-yts/blob/main/assets/demo.png?raw=true)

## Features

- Import transcripts from any YouTube video with captions
- Clickable timestamps that jump to the video position
- Multiple format options: nested blocks, single block, or code block

## Installation

1. Go to **Settings > Roam Depot > Community Extensions**
2. Search for "YouTube Transcript Sync"
3. Click **Install**

## Setup

1. Get your API key from [supadata.ai](https://supadata.ai) (free tier includes 100 credits/month - enough for daily use)
2. Open **Settings > YouTube Transcript Sync**
3. Enter your API key

![Settings](https://github.com/qcrao/roam-yts/blob/main/assets/settings.png?raw=true)

## Usage

1. Paste a YouTube URL in any block (e.g., `https://youtube.com/watch?v=...`)
2. Click on the block containing the URL
3. Open command palette (`Cmd/Ctrl + P`) and run **Import Youtube Transcript**

> **Tip**: To enable clickable timestamp navigation, click the small button before the YouTube link to embed the video. Without embedding, transcripts will still be imported but timestamps won't jump to the video position.

![Usage](https://github.com/qcrao/roam-yts/blob/main/assets/usage.png?raw=true)

## Transcript Formats

| Format | Description |
|--------|-------------|
| **Nested Blocks** | Each segment as a child block with clickable timestamp |
| **Single Block** | All text in one block with soft line breaks and clickable timestamps |
| **Code Block** | Plain text in a code block (timestamps are not clickable) |

![single block](https://github.com/qcrao/roam-yts/blob/main/assets/single%20block.png?raw=true)

![code block](https://github.com/qcrao/roam-yts/blob/main/assets/code%20block.png?raw=true)

## License

MIT
