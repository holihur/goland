# Security model and threat notes

## Boundaries

- Authentication: admin-created accounts, argon2id passwords, HttpOnly SameSite session cookie, server-side sessions, double-submit CSRF header, optional TOTP MFA (with forced enrollment), optional OIDC single sign-on, and scoped personal access tokens.
- Authorization: every workspace lookup includes `ownerId`; cross-tenant resources return 404 to avoid existence leaks.
- Filesystem: API paths are relative, canonicalized, checked against the workspace root, and checked after resolving the deepest existing ancestor. `.git` is denied, symlink escape is rejected.
- Processes: terminal, LSP, tasks and debuggers run as a per-workspace Unix UID. Workspace roots are mode 0700.
- Secrets: Git tokens and pending TOTP secrets are AES-256-GCM encrypted with a key stored outside Mongo. Recovery codes and personal access tokens are stored as SHA-256 hashes. Plaintext credentials are returned only once at creation.
- WebSockets: authenticated by session cookie; Origin is validated against the request host or `GOLAND_ALLOWED_ORIGINS`.
- OIDC: authorization-code flow with state, nonce and PKCE; ID tokens are verified against the provider JWKS, issuer and audience. Verified email is required by default and auto-provisioning is disabled by default.
- Personal access tokens: hashed at rest, scoped (`read`, `write`, `git`, `run`, `mcp`), optionally expiring, revocable, and unable to manage other tokens. Bearer-token requests skip CSRF because they do not rely on cookies. The MCP endpoint additionally requires the `mcp` scope.
- Git operations never force-push; pull is `--ff-only` and a divergent branch returns a conflict without modifying files.

## Plugins

- Installation requires an administrator. Packages are validated (manifest, executable
  containment, zip traversal/symlink rejection, size/file limits) before being stored under
  the server data directory.
- Enabling a plugin is scoped to the workspace owner. Cross-tenant plugin and workspace
  requests return 404, and plugin websocket routes require an authenticated session and a
  valid Origin.
- Plugin hosts and plugin-provided LSP/DAP servers run as the workspace Unix UID with the
  workspace as cwd and an isolated `HOME`/`TMPDIR`. Commands and hooks have timeouts, output
  caps, process-group cleanup and audit records. Disabling a plugin, deleting a workspace or
  uninstalling a plugin stops its process groups.
- Plugins are **trusted code** for that workspace. There is no capability sandbox and no
  network isolation: a plugin can read/write anything the workspace UID can and make network
  requests. Install only reviewed packages on shared hosts.
- Frontend modules are administrator-installed ES modules rendered as Web Components. They
  run as trusted page code with the user's browser privileges. Shadow DOM isolates styling,
  not security. Declarative panels remain the safer option for untrusted or semi-trusted
  plugins.
- Git/file hooks receive JSON over stdio, never shell-interpolated arguments, and hook
  failures follow the manifest's fail-open/fail-closed policy.

## Residual risks

- Development mode can grant traverse-only access to `/root` so workspace UIDs can execute the mise toolchain. Do not enable `GOLAND_DEV_PERMISSIONS` on a shared host.
- The backend service user can read all workspaces; it is the trusted control plane.
- Local imports are chowned to the workspace UID. Import only dedicated project directories.
- A browser debug session intentionally starts a local Chromium under the workspace UID; treat debug URLs as untrusted.
- A plugin runs with the full privileges of its workspace UID and can access the network. The plugin store and LSP/DAP paths rely on Unix permissions; do not install unreviewed packages.
- Compose currently runs the backend as root because it must create workspace users and set credentials. Production hardening can move user provisioning to a privileged init container.
- There is no audit UI or multi-node session isolation yet. OIDC and MFA are single-node features backed by Mongo; horizontal scaling must share Mongo and the encryption key.
- Personal access tokens bypass interactive MFA by design once issued. Revoke tokens if a device or agent is compromised.
