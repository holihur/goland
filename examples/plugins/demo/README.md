# Demo plugin

Example Goland plugin implementing commands, a declarative panel, a status item, settings,
editor actions, save formatting and a pre-commit hook. It speaks newline-delimited JSON-RPC
2.0 over stdio; see `../../../docs/architecture.md#plugin-system`.

Build and package:

```bash
go build -trimpath -o bin/demo .
../../../scripts/package-plugin.sh . demo.zip
```

Upload `demo.zip` from **user menu → Plugins** as an administrator, then enable it in a
workspace's settings. The **Demo toolkit** activity-bar icon opens the panel; **Say hello**
and **Scan workspace** are also in the command palette. Saving a file trims trailing
whitespace, and commits whose message contains "block" are rejected.
