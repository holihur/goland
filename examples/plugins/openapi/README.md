# OpenAPI plugin

OpenAPI/Swagger support for Goland implemented as a plugin:

- discover `openapi.json/yaml`, `swagger.json/yaml` specs in the workspace
- show spec overview, servers and endpoint inventory
- validate the document structure
- send test HTTP requests using `servers[0].url` or an explicit base URL
- a native Web Component console with Shadow DOM

The plugin executable runs as the workspace Unix user; request testing therefore uses that
user's network permissions. Spec files are restricted to the workspace root.

Build and package:

```bash
go build -trimpath -o bin/openapi .
../../../scripts/package-plugin.sh . openapi.zip
```

Upload `openapi.zip` from the admin Plugins dialog, enable **OpenAPI** in workspace settings,
then open **OpenAPI console** from the activity bar.
