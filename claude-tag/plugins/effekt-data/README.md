# effekt-data (Claude Tag plugin)

Connects Claude Tag to the API's Claude Tag-only MCP server at
`https://data.gieffektivt.no/mcp-tag`. The plugin carries no credentials: a Bearer custom
connector for `data.gieffektivt.no` in Claude Tag's admin settings supplies the token at the
proxy. See [docs/pseudo-db.md](../../../docs/pseudo-db.md#the-claude-tag-connector-mcp-tag).
