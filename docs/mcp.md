# Personal access tokens and MCP

Goland exposes a small Model Context Protocol server so external agents can inspect and edit
workspaces. Access is authenticated with a personal access token.

## Create a token

In the IDE open the user menu → **API tokens**. Choose scopes:

| Scope | Allows |
| --- | --- |
| `read` | Workspace metadata, file listing/reading, path and content search |
| `write` | Write files and replace content |
| `git` | Git status and diffs |
| `run` | Run one Go/Vitest test |
| `mcp` | Use the MCP endpoint |

The token is displayed once. Send it as `Authorization: Bearer glpat_…`. Tokens cannot be used
to list, create or revoke other tokens; use a browser session for token management.

## MCP endpoint

`POST /api/mcp` speaks JSON-RPC 2.0 and supports the standard `initialize`, `tools/list` and
`tools/call` methods. The server is stateless; no session id is required.

Example:

```bash
curl -s http://127.0.0.1:8788/api/mcp \
  -H "Authorization: Bearer $GOLAND_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_workspaces","arguments":{}}}'
```

Tools: `list_workspaces`, `get_workspace`, `list_files`, `read_file`, `search_files`,
`search_content`, `write_file`, `replace_content`, `git_status`, `git_diff`, `list_tests`,
`run_test`.

Example MCP client configuration (Claude Desktop style):

```json
{
  "mcpServers": {
    "goland": {
      "url": "http://127.0.0.1:8788/api/mcp",
      "headers": { "Authorization": "Bearer glpat_…" }
    }
  }
}
```

Token creation requires an MFA-complete browser session when MFA is enforced. Tools are
audited and scoped to the token owner's workspaces.
