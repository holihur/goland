# SSH plugin

Non-interactive SSH support for Goland, implemented as a plugin:

- run remote commands with the OpenSSH client from the SSH console
- test host connectivity
- list `Host` aliases from `~/.ssh/config` (or the configured config path)
- status-bar result reporting
- a native Web Component console with Shadow DOM

This plugin intentionally runs commands non-interactively (`BatchMode=yes`); use the built-in
workspace terminal for an interactive SSH session. The plugin process runs as the workspace Unix
user, so key and `known_hosts` permissions follow that user.

Build and package:

```bash
go build -trimpath -o bin/ssh .
../../scripts/package-plugin.sh . ssh.zip
```

Upload `ssh.zip` from the admin Plugins dialog, enable **SSH** in workspace settings, then open
**SSH console** from the activity bar.
