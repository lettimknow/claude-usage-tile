# Claude Code Usage Tile

The Claude Code usage card that Claude Desktop removed in version 2.42304.0, back as an artifact pinned in your sidebar.

<img src="docs/tile.png" alt="The tile in light and dark: Overview with six numbers and a 26-week activity grid, Models with tokens per day by model">

Tokens count each API response once, cache reads and writes included, and come with their cost at Claude API prices. Context compaction and Claude Code's background calls aren't in the transcripts, so they aren't counted.

## Setup

Paste this into Claude Code in the desktop app:

```text
Set up https://github.com/lettimknow/claude-usage-tile for me
```

## For Claude

1. Download [claude-usage-tile.mcpb](https://github.com/lettimknow/claude-usage-tile/releases/latest/download/claude-usage-tile.mcpb) and open it with the Claude app (on macOS: `open -a Claude <file>`). It's the extension that reads the user's Claude Code stats. Ask the user to click **Install** and wait until they do.
2. Download [tile.html](https://github.com/lettimknow/claude-usage-tile/releases/latest/download/tile.html), read it and publish it unchanged as an artifact with the icon `chart` and these capabilities:

   ```json
   {"mcp": {"servers": [{"server": "host:Claude_Code_Usage_Tile", "tools": ["get_usage_stats"]}]},
    "user": {"scopes": ["profile"]}}
   ```

3. Pin the artifact to the user's sidebar and tell them to open it from there, not from a link in the chat: the sidebar opens it where it can reach the extension.

Not affiliated with Anthropic.
