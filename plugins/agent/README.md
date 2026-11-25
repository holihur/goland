# Agent plugin

Wraps the local [`../agent`](../../agent) CLI as a Goland plugin:

- one-shot prompts with persistent sessions
- workspace `.env` support for `LLM_API_KEY`/`LLM_APIKEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API`
- optional explicitly configured credentials, API style, model, max turns
- file tools on by default, shell tool off by default
- native Web Component console with Shadow DOM
- streamed command output notifications are forwarded to the plugin status/event bus

The plugin invokes the `agent` binary as the workspace Unix user. Install it with:

```bash
cd ../../agent
go build -trimpath -o /usr/local/bin/agent ./cmd/agent
```

Then build and package this plugin:

```bash
go build -trimpath -o bin/goland-agent .
../../scripts/package-plugin.sh . agent.zip
```

Upload `agent.zip` from the admin Plugins dialog, enable **Agent** in workspace settings, then
open **Agent console** from the activity bar. The console is the single UI entry point; the
plugin intentionally does not contribute a duplicate declarative panel. Put LLM credentials in the workspace `.env` or
configure them in the plugin settings. Prefer workspace `.env` or a future BYOK bridge over
storing long-lived keys in plugin settings.
