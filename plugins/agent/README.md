# Agent plugin

An embedded coding agent for Goland. The agent runtime is vendored at
[`../../agent`](../../agent) (upstream: `github.com/holihur/agent`) and runs inside the plugin
process, so no separate `agent` binary is required.

Features:

- one-shot prompts with persistent sessions
- workspace `.env` support for `LLM_API_KEY`/`LLM_APIKEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API`
- optional explicit credentials, API style, model and max turns
- file tools on by default, shell tool off by default
- native Web Component console with streaming output and cancellation
- host status/error reporting

Build and package:

```bash
go mod tidy
go build -trimpath -o bin/goland-agent .
../../scripts/package-plugin.sh . agent.zip
```

Upload `agent.zip` from the admin Plugins dialog, enable **Agent** in workspace settings, then
open **Agent console** from the activity bar. Put LLM credentials in the workspace `.env` or
configure them in plugin settings. The console is the single UI entry point.

## Vendored upstream

The agent runtime lives in [`../../agent`](../../agent) and is imported through a local module
replacement. It was imported with:

```bash
git subtree add --prefix agent git@github.com:holihur/agent.git main --squash
```

Pull upstream improvements:

```bash
git subtree pull --prefix agent git@github.com:holihur/agent.git main --squash
```

Keep local patches as normal commits. Resolve subtree conflicts in `agent/`, then rebuild this
plugin. Before redistributing the vendored code, confirm the upstream license.
