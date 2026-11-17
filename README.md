# Claude Code Usage Tile

The Claude Code usage card that Claude Desktop removed in version 2.42304.0, back as an artifact pinned in your sidebar.

<img src="docs/tile.png" alt="The tile in light and dark: Overview with six numbers and a 26-week activity grid, Models with tokens per day by model">

## Setup

1. Install the extension that reads your Claude Code stats: download [claude-usage-tile.mcpb](https://github.com/lettimknow/claude-usage-tile/releases/latest/download/claude-usage-tile.mcpb), double-click it and click **Install**.
2. Paste this into Claude Code in the desktop app:

   ```text
   Set up the Claude Code Usage Tile for me. Download
   https://github.com/lettimknow/claude-usage-tile/releases/latest/download/tile.html,
   read it, and publish it unchanged as an artifact with the icon "chart" and these
   capabilities:
   {"mcp": {"servers": [{"server": "host:Claude_Code_Usage_Tile", "tools": ["get_usage_stats"]}]},
    "user": {"scopes": ["profile"]}}
   Then pin it to my sidebar.
   ```

Not affiliated with Anthropic.
