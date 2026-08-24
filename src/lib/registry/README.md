# Pnyxy community registry

This module fetches **themes** and **plugins** authored by the community
from a public GitHub repository (default
`https://github.com/LenYx24/pnyxy-community`). Files are pulled raw via
`raw.githubusercontent.com` with a 1-hour `localStorage` cache.

When the primary registry is unreachable (offline / corp proxy / DNS
failure), `CompositeRegistry` falls back to a small
`BundledFallbackRegistry` that ships inside the app, so first-run users
always see something to install.

## Repository layout

```
pnyxy-community/
├── index.json
├── themes/
│   ├── solar.json
│   └── nord.json
└── plugins/
    └── word-counter/
        ├── manifest.json
        └── 1.0.0/
            └── plugin.js
```

### `index.json`

```jsonc
{
  "apiVersion": 1,
  "themes": [
    {
      "kind": "theme",
      "id": "solar",
      "name": "Solar",
      "version": "1",
      "description": "Warm sunset palette.",
      "author": "you"
    }
  ],
  "plugins": [
    {
      "kind": "plugin",
      "id": "word-counter",
      "name": "Word Counter",
      "version": "1.0.0",
      "description": "Counts words on the current page.",
      "author": "you"
    }
  ]
}
```

### Theme file (`themes/<id>.json`)

A serialized `Theme` (see `src/lib/themes/types.ts`):

```jsonc
{
  "id": "solar",
  "name": "Solar",
  "apiVersion": 1,
  "variant": "dark",
  "tokens": {
    "--color-bg-primary": "#1a1208",
    "--color-text-primary": "#fef3c7"
  }
}
```

Only tokens listed in `ThemeTokenKey` are honored. Anything missing
falls through to the app's `@theme` defaults.

### Plugin manifest (`plugins/<id>/manifest.json`)

```jsonc
{
  "id": "word-counter",
  "name": "Word Counter",
  "version": "1.0.0",
  "apiVersion": 1,
  "author": "you",
  "description": "Counts words on the current page.",
  "entry": "1.0.0/plugin.js",
  "permissions": ["events:reader", "notifications", "commands"],
  "runtime": ["sandboxed"]
}
```

### Plugin bundle (`plugins/<id>/<version>/plugin.js`)

A plain JavaScript file. Inside the sandbox, the global `plugin` is the
[`PluginAPI`](../plugins/types.ts). At minimum, define `onLoad`:

```js
async function onLoad(api) {
  await api.commands.register("word-counter:show", "Word Counter: Show count");
  plugin.commands.on("word-counter:show", function () {
    return plugin.notifications.show("Hello from a plugin!");
  });
}
```

`PluginAPI` is JSON-only, every argument and return value must
round-trip `JSON.stringify`. Don't pass functions, DOM nodes, or class
instances across the API boundary.

## Sandbox guarantees

- The plugin runs in an `<iframe sandbox="allow-scripts">` (no
  `allow-same-origin`). It cannot read host cookies, `localStorage`,
  `IndexedDB`, or talk to Supabase.
- All API calls go through host-side permission checks listed in
  `manifest.permissions`. Calling a method without the permission
  rejects with `PermissionDeniedError`.
- The host injects the bundle JS as inline `<script>` text into the
  iframe `srcdoc` (the opaque-origin iframe cannot `fetch`
  cross-origin itself). Bundles are pulled by the **host** over HTTPS.

## Submitting a contribution

1. Fork `LenYx24/pnyxy-community`.
2. Add your files in `themes/` or `plugins/<id>/<version>/`.
3. Add an entry to `index.json`.
4. Open a PR.
