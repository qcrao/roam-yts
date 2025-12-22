# YouTube Transcript Sync

A Roam Research extension that fetches YouTube video transcripts and inserts them into your graph.

![Demo](screenshots/demo.png)

## Features

- Import transcripts from any YouTube video with captions
- Clickable timestamps that jump to the video position
- Multiple format options: nested blocks, single block, or code block

## Installation

1. Go to **Settings > Roam Depot > Community Extensions**
2. Search for "YouTube Transcript Sync"
3. Click **Install**

## Setup

1. Get your API key from [supadata.ai](https://supadata.ai)
2. Open **Settings > YouTube Transcript Sync**
3. Enter your API key

![Settings](screenshots/settings.png)

## Usage

1. Embed a YouTube video in your graph using `{{[[video]]: https://youtube.com/watch?v=...}}`
2. Click on a block under the video
3. Open command palette (`Cmd/Ctrl + P`) and run **Import Youtube Transcript**

![Usage](screenshots/usage.png)

## Transcript Formats

| Format | Description |
|--------|-------------|
| **Nested Blocks** | Each segment as a child block with timestamp |
| **Single Block** | All text in one block with soft line breaks |
| **Code Block** | Plain text in a code block |

## License

MIT
