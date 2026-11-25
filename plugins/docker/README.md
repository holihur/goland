# Docker plugin

Docker support for Goland implemented as a plugin. It contributes:

- a Docker console with container, image, Compose, logs and build actions
- a native Web Component console (`web/app.js`) loaded as an ES module with Shadow DOM
- status-bar health reporting
- Docker binary, `DOCKER_HOST`, Compose file and timeout settings

The plugin runs the Docker CLI as the workspace Unix user. Docker socket permissions therefore
apply to that user. If the daemon is unavailable the panel reports the CLI error instead of
failing plugin startup.

Build and package:

```bash
go build -trimpath -o bin/docker .
../../scripts/package-plugin.sh . docker.zip
```

Upload `docker.zip` from the admin Plugins dialog, enable **Docker** in a workspace's settings,
then open **Docker console** from the activity bar.

## Frontend module contract

`web/app.js` is an ES module that default-exports a custom element class. The host imports it,
defines the element in the page, and sets an `api` property before mounting:

```js
export default class MyView extends HTMLElement {
  set api(value) { /* execute commands, open files, show notifications */ }
}
```

The module is trusted code installed by an administrator and runs with the page's privileges.
Use a Shadow DOM for style isolation, as this plugin does.
