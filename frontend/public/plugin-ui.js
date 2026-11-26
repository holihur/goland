/**
 * Shared UI kit for Goland plugin frontends.
 *
 * Loaded by plugin Web Components from /plugin-ui.js. It is intentionally
 * dependency-free so plugin packages stay small and the host can evolve its
 * design system without rebuilding every plugin.
 */

const ICON_PATHS = {
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  eraser: '<path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4L13 3l8 8-7 7"/><path d="M22 21H7"/>',
  refresh: '<path d="M20 11a8 8 0 1 0 2 5"/><path d="M20 4v7h-7"/>',
  settings: '<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  container: '<path d="M4 8h16"/><path d="M6 8V4h12v4"/><path d="M5 8h14l-1.5 12h-11L5 8Z"/><path d="M9 12h6"/>',
  network: '<rect x="2" y="2" width="6" height="6" rx="1"/><rect x="16" y="2" width="6" height="6" rx="1"/><rect x="9" y="16" width="6" height="6" rx="1"/><path d="M5 8v4h14V8"/><path d="M12 12v4"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/>',
  sparkles: '<path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9L12 3Z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  files: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/>',
  server: '<rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 6.5h.01"/><path d="M6 17.5h.01"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  layers: '<path d="m12.8 2.3 8.3 4.2a1 1 0 0 1 0 1.8L12.8 12.5a2 2 0 0 1-1.6 0L2.9 8.3a1 1 0 0 1 0-1.8l8.3-4.2a2 2 0 0 1 1.6 0Z"/><path d="m2.9 12.3 8.3 4.2a2 2 0 0 0 1.6 0l8.3-4.2"/><path d="m2.9 16.3 8.3 4.2a2 2 0 0 0 1.6 0l8.3-4.2"/>',
};

export function icon(name, size = 14) {
  const path = ICON_PATHS[name] || ICON_PATHS.terminal;
  return `<svg class="pc-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const PLUGIN_CSS = `
  :host {
    --pc-fg: hsl(var(--foreground, 210 20% 96%));
    --pc-muted: hsl(var(--muted-foreground, 216 10% 58%));
    --pc-bg: hsl(var(--background, 220 16% 7%));
    --pc-panel: hsl(var(--panel, 220 14% 9%));
    --pc-border: hsl(var(--border, 218 13% 19%) / .85);
    --pc-accent: hsl(var(--accent, 218 14% 17%));
    --pc-primary: hsl(var(--primary, 199 89% 55%));
    --pc-primary-fg: hsl(var(--primary-foreground, 220 20% 6%));
    --pc-danger: #f87171;
    --pc-success: #34d399;
    --pc-warning: #fbbf24;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    color: var(--pc-fg);
    background: var(--pc-bg);
    font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color-scheme: dark;
  }
  :host([data-theme="light"]) { color-scheme: light; }
  *, *::before, *::after { box-sizing: border-box; }
  .pc-shell { display: flex; flex: 1; flex-direction: column; width: 100%; max-width: 100%; min-width: 0; min-height: 0; overflow: hidden; background: radial-gradient(120% 70% at 50% 0%, hsl(var(--primary) / .055), transparent 55%); }
  .pc-body { flex: 1; width: 100%; max-width: 100%; min-width: 0; min-height: 0; overflow: auto; padding: 14px; }
  .pc-stack, .pc-card, .pc-console, .pc-console-body, .pc-grid, .pc-field, .pc-actions, .pc-tabs { min-width: 0; max-width: 100%; }
  .pc-stack { display: flex; flex-direction: column; gap: 12px; }
  .pc-icon { flex: none; }
  .pc-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    height: 30px; padding: 0 11px; border: 1px solid var(--pc-border); border-radius: 7px;
    background: color-mix(in srgb, var(--pc-panel) 75%, transparent); color: var(--pc-fg);
    font: inherit; font-size: 11px; font-weight: 500; white-space: nowrap; cursor: pointer;
    transition: background .12s, border-color .12s, opacity .12s;
  }
  .pc-btn:hover { background: var(--pc-accent); border-color: color-mix(in srgb, var(--pc-muted) 38%, transparent); }
  .pc-btn { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .pc-btn:focus-visible, .pc-icon-btn:focus-visible, .pc-tab:focus-visible, .pc-action:focus-visible { outline: 2px solid hsl(var(--primary) / .65); outline-offset: 1px; }
  .pc-btn:disabled { opacity: .45; cursor: not-allowed; }
  .pc-btn.primary { background: var(--pc-primary); border-color: transparent; color: var(--pc-primary-fg); font-weight: 600; }
  .pc-btn.primary:hover { background: color-mix(in srgb, var(--pc-primary) 88%, white); }
  .pc-btn.ghost { background: transparent; }
  .pc-btn.danger { color: var(--pc-danger); border-color: color-mix(in srgb, var(--pc-danger) 35%, transparent); background: color-mix(in srgb, var(--pc-danger) 8%, transparent); }
  .pc-icon-btn {
    display: inline-grid; place-items: center; width: 26px; height: 26px; padding: 0;
    border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--pc-muted); cursor: pointer;
  }
  .pc-icon-btn:hover { color: var(--pc-fg); background: var(--pc-accent); }
  .pc-card {
    border: 1px solid var(--pc-border); border-radius: 10px; background: color-mix(in srgb, var(--pc-panel) 62%, transparent);
    padding: 13px;
  }
  .pc-card-head { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; color: var(--pc-fg); font-size: 11px; font-weight: 600; }
  .pc-card-head .pc-icon { color: var(--pc-primary); }
  .pc-kicker { color: var(--pc-muted); font-size: 9px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }
  .pc-help { color: var(--pc-muted); font-size: 10px; line-height: 1.5; }
  .pc-muted { color: var(--pc-muted); }
  .pc-row { display: flex; align-items: center; gap: 8px; }
  .pc-grow { flex: 1; min-width: 0; }
  .pc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .pc-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .pc-field > span { color: var(--pc-muted); font-size: 10px; font-weight: 500; }
  .pc-field.span-2 { grid-column: 1 / -1; }
  .pc-input, .pc-select, .pc-textarea {
    width: 100%; max-width: 100%; min-width: 0; border: 1px solid var(--pc-border); border-radius: 7px; background: color-mix(in srgb, var(--pc-bg) 70%, transparent);
    color: var(--pc-fg); font: inherit; font-size: 11px; padding: 0 9px; transition: border-color .12s, box-shadow .12s;
  }
  .pc-input, .pc-select { height: 30px; }
  .pc-textarea { min-height: 62px; padding: 8px 9px; resize: vertical; }
  .pc-input::placeholder, .pc-textarea::placeholder { color: color-mix(in srgb, var(--pc-muted) 65%, transparent); }
  .pc-input:focus, .pc-select:focus, .pc-textarea:focus { outline: none; border-color: color-mix(in srgb, var(--pc-primary) 70%, transparent); box-shadow: 0 0 0 3px hsl(var(--primary) / .12); }
  .pc-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
  .pc-actions.end { justify-content: flex-end; }
  .pc-divider { height: 1px; background: var(--pc-border); margin: 2px 0; }
  .pc-tabs { display: flex; gap: 3px; padding: 3px; border: 1px solid var(--pc-border); border-radius: 8px; background: color-mix(in srgb, var(--pc-panel) 55%, transparent); overflow-x: auto; scrollbar-width: none; }
  .pc-tab {
    flex: 1; height: 27px; border: 0; border-radius: 6px; background: transparent; color: var(--pc-muted);
    font: inherit; font-size: 10px; font-weight: 500; cursor: pointer;
  }
  .pc-tab:hover { color: var(--pc-fg); }
  .pc-tab[aria-selected="true"] { background: var(--pc-accent); color: var(--pc-fg); box-shadow: 0 1px 2px hsl(0 0% 0% / .12); }
  .pc-action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .pc-action {
    display: flex; align-items: center; gap: 7px; min-height: 38px; padding: 7px 9px; border: 1px solid var(--pc-border);
    border-radius: 8px; background: color-mix(in srgb, var(--pc-panel) 45%, transparent); color: var(--pc-fg);
    font: inherit; font-size: 10px; text-align: left; cursor: pointer; transition: background .12s, border-color .12s;
  }
  .pc-action:hover { background: var(--pc-accent); border-color: color-mix(in srgb, var(--pc-muted) 34%, transparent); }
  .pc-action .pc-icon { color: var(--pc-muted); }
  .pc-action[aria-pressed="true"] { border-color: color-mix(in srgb, var(--pc-primary) 55%, transparent); background: hsl(var(--primary) / .10); }
  .pc-action[aria-pressed="true"] .pc-icon { color: var(--pc-primary); }
  .pc-chip { display: inline-flex; align-items: center; gap: 5px; height: 23px; padding: 0 8px; border: 1px solid var(--pc-border); border-radius: 999px; background: transparent; color: var(--pc-muted); font: inherit; font-size: 9px; cursor: pointer; }
  .pc-chip:hover { color: var(--pc-fg); border-color: color-mix(in srgb, var(--pc-muted) 34%, transparent); background: var(--pc-accent); }
  .pc-badge { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 7px; border-radius: 999px; background: color-mix(in srgb, var(--pc-muted) 12%, transparent); color: var(--pc-muted); font-size: 9px; font-weight: 500; white-space: nowrap; }
  .pc-badge.success { color: var(--pc-success); background: color-mix(in srgb, var(--pc-success) 12%, transparent); }
  .pc-badge.warning { color: var(--pc-warning); background: color-mix(in srgb, var(--pc-warning) 12%, transparent); }
  .pc-badge.error { color: var(--pc-danger); background: color-mix(in srgb, var(--pc-danger) 12%, transparent); }
  .pc-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
  .pc-error { display: flex; gap: 8px; align-items: flex-start; padding: 9px 10px; border: 1px solid color-mix(in srgb, var(--pc-danger) 30%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--pc-danger) 8%, transparent); color: var(--pc-danger); font-size: 10px; line-height: 1.5; }
  .pc-error .pc-icon { margin-top: 1px; }
  .pc-console { display: flex; flex: 0 0 36%; flex-direction: column; min-height: 140px; max-height: 60%; border-top: 1px solid var(--pc-border); background: color-mix(in srgb, var(--pc-panel) 62%, transparent); }
  @media (max-height: 560px) { .pc-console { flex-basis: 44%; } }
  .pc-console-head { display: flex; align-items: center; gap: 7px; height: 33px; padding: 0 10px; border-bottom: 1px solid var(--pc-border); }
  .pc-console-title { display: flex; align-items: center; gap: 6px; color: var(--pc-muted); font-size: 9px; font-weight: 600; letter-spacing: .10em; text-transform: uppercase; }
  .pc-console-title .pc-icon { color: var(--pc-primary); }
  .pc-meta { color: var(--pc-muted); font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pc-console-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; }
  .pc-stop { height: 24px; padding: 0 8px; font-size: 10px; color: var(--pc-danger); border-color: color-mix(in srgb, var(--pc-danger) 30%, transparent); background: color-mix(in srgb, var(--pc-danger) 8%, transparent); }
  .pc-console-body { position: relative; flex: 1; min-height: 0; overflow: auto; }
  .pc-pre { margin: 0; padding: 10px 12px; color: color-mix(in srgb, var(--pc-fg) 86%, var(--pc-muted)); font: 11px/1.6 "JetBrains Mono", "SFMono-Regular", Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
  .pc-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 100px; padding: 16px; color: var(--pc-muted); font-size: 10px; text-align: center; }
  .pc-empty-icon { color: color-mix(in srgb, var(--pc-muted) 48%, transparent); }
  .pc-empty[hidden], .pc-pre[hidden], [hidden] { display: none !important; }
  .pc-spin { animation: pc-spin .8s linear infinite; }
  @keyframes pc-spin { to { transform: rotate(360deg); } }
  @media (max-width: 420px) { .pc-grid, .pc-action-grid { grid-template-columns: 1fr; } .pc-field.span-2 { grid-column: auto; } .pc-body { padding: 11px; } }
`;

export class PluginConsole extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._built = false;
    this._busy = false;
    this._requestId = "";
    this._streamed = "";
    this._startedAt = 0;
    this._theme = "dark";
    this._onKey = (event) => this.handleKey(event);
  }

  set api(value) {
    this._api = value;
    this._theme = value?.theme || "dark";
    this.style.colorScheme = this._theme;
    this.toggleAttribute("data-theme", this._theme === "light");
    this.dataset.theme = this._theme;
    this.build();
    this.onApi?.(value);
  }

  get api() { return this._api; }
  get consoleEnabled() { return true; }
  get consoleTitle() { return "Output"; }
  get consoleIcon() { return "terminal"; }
  get emptyText() { return "Run an action to see output."; }
  get emptyIcon() { return "terminal"; }
  get layout() { return "default"; }
  get styles() { return this.constructor.styles || ""; }

  connectedCallback() { this.build(); }

  build() {
    if (this._built) return;
    this._built = true;
    this.dataset.layout = this.layout;
    const consoleHTML = this.consoleEnabled
      ? `<section class="pc-console">
          <header class="pc-console-head">
            <span class="pc-console-title">${icon(this.consoleIcon, 12)} ${escapeHTML(this.consoleTitle)}</span>
            <span class="pc-meta"></span>
            <span class="pc-console-actions">
              <button class="pc-icon-btn" data-pc="copy" title="Copy output" aria-label="Copy output">${icon("copy", 13)}</button>
              <button class="pc-icon-btn" data-pc="clear" title="Clear output" aria-label="Clear output">${icon("eraser", 13)}</button>
              <button class="pc-btn pc-stop" data-pc="stop" hidden>${icon("stop", 12)} Stop</button>
            </span>
          </header>
          <div class="pc-console-body">
            <div class="pc-empty"><div class="pc-empty-icon">${icon(this.emptyIcon, 24)}</div><div>${escapeHTML(this.emptyText)}</div></div>
            <pre class="pc-pre" aria-live="polite" hidden></pre>
          </div>
        </section>`
      : "";
    this.shadowRoot.innerHTML = `<style>${PLUGIN_CSS}${this.styles}</style><div class="pc-shell"><div class="pc-body"></div>${consoleHTML}</div>`;
    this.body = this.shadowRoot.querySelector(".pc-body");
    this._pre = this.shadowRoot.querySelector(".pc-pre");
    this._empty = this.shadowRoot.querySelector(".pc-empty");
    this._meta = this.shadowRoot.querySelector(".pc-meta");
    this._stopButton = this.shadowRoot.querySelector('[data-pc="stop"]');
    this._copyButton = this.shadowRoot.querySelector('[data-pc="copy"]');
    this._clearButton = this.shadowRoot.querySelector('[data-pc="clear"]');
    this._copyButton?.addEventListener("click", () => this.copyOutput());
    this._clearButton?.addEventListener("click", () => this.clearOutput());
    this._stopButton?.addEventListener("click", () => this.cancel());
    this.body.innerHTML = this.render();
    this.shadowRoot.addEventListener("keydown", this._onKey);
    this.bind();
  }

  render() { return ""; }
  bind() {}
  onApi() {}
  primaryAction() {}

  handleKey(event) {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key === "Enter") {
      event.preventDefault();
      this.primaryAction();
    } else if (event.key === "Escape" && this._busy) {
      event.preventDefault();
      this.cancel();
    }
  }

  normalizeOutput(value) { return value || "(no output)"; }

  async run(commandId, inputs, options = {}) {
    if (!this._api || this._busy) return null;
    if (options.validate && !options.validate()) return null;
    this._busy = true;
    this._requestId = "";
    this._streamed = "";
    this._startedAt = performance.now();
    this._setBusyUI(true);
    if (options.clear !== false) this.clearOutput();
    this.showError("");
    this.setStatus(options.label || "Running…", "running");
    try {
      const result = await this._api.execute(commandId, inputs, {
        onRequest: (requestId) => {
          this._requestId = requestId;
          options.onRequest?.(requestId);
        },
        onChunk: (chunk) => {
          this._streamed += chunk;
          if (this._pre && options.output !== false) this.appendOutput(chunk);
          options.onChunk?.(chunk, this._streamed);
        },
      });
      if (this._pre && options.output !== false && !this._streamed) {
        this.setOutput(this.normalizeOutput(result.output || ""));
      }
      options.onResult?.(result, this._streamed);
      this.finish(options.successLabel || "Finished", "success");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this._pre && options.output !== false) {
        if (this._streamed) this.appendOutput(`\n[error] ${message}`);
        else this.setOutput(message);
      }
      this.finish(options.errorLabel || "Failed", "error");
      options.onError?.(message);
      return null;
    } finally {
      this._busy = false;
      this._setBusyUI(false);
      this.setMeta();
    }
  }

  async cancel() {
    if (!this._api || !this._requestId || !this._busy) return;
    this.setStatus("Cancelling…", "running");
    if (this._stopButton) this._stopButton.disabled = true;
    try { await this._api.cancel(this._requestId); } catch { /* command already finished */ }
  }

  finish(label, kind) {
    this.setStatus(label, kind);
    this.setMeta();
  }

  setStatus(text, kind = "info") {
    this._api?.setStatus?.(text, kind);
  }

  setMeta() {
    if (!this._meta) return;
    const duration = this._startedAt ? `${((performance.now() - this._startedAt) / 1000).toFixed(1)}s` : "";
    this._meta.textContent = [duration, this._requestId ? `req ${this._requestId.slice(0, 8)}` : ""].filter(Boolean).join("  ·  ");
  }

  _setBusyUI(busy) {
    this.toggleAttribute("data-busy", busy);
    this.shadowRoot.querySelectorAll("[data-plugin-action]").forEach((button) => { button.disabled = busy; });
    if (this._stopButton) {
      this._stopButton.hidden = !busy;
      this._stopButton.disabled = false;
    }
    if (this._copyButton) this._copyButton.disabled = false;
  }

  appendOutput(chunk) {
    if (!this._pre) return;
    this._empty?.setAttribute("hidden", "");
    this._pre.hidden = false;
    this._pre.textContent += chunk;
    const body = this._pre.parentElement;
    if (body) body.scrollTop = body.scrollHeight;
  }

  setOutput(value) {
    if (!this._pre) return;
    const text = String(value ?? "");
    if (!text) { this.clearOutput(); return; }
    this._empty?.setAttribute("hidden", "");
    this._pre.hidden = false;
    this._pre.textContent = text;
    const body = this._pre.parentElement;
    if (body) body.scrollTop = body.scrollHeight;
  }

  clearOutput() {
    if (this._pre) { this._pre.textContent = ""; this._pre.hidden = true; }
    this._empty?.removeAttribute("hidden");
    if (this._meta) this._meta.textContent = "";
  }

  copyOutput() {
    const text = this._pre?.textContent ?? "";
    if (!text || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text).then(() => {
      if (!this._meta) return;
      const previous = this._meta.textContent;
      this._meta.textContent = "Copied to clipboard";
      window.setTimeout(() => { if (this._meta) this._meta.textContent = previous; }, 1200);
    });
  }

  showError(message) {
    this.shadowRoot.querySelector(".pc-error")?.remove();
    if (!message) return;
    const error = document.createElement("div");
    error.className = "pc-error";
    error.innerHTML = `${icon("alert", 14)}<span></span>`;
    error.querySelector("span").textContent = message;
    this.body.prepend(error);
  }

  configure() { this._api?.configure?.(); }

  storageKey(key) { return `goland.plugin.${this.constructor.storageKey || this.tagName.toLowerCase()}.${key}`; }
  restore(key, fallback = "") {
    try { return localStorage.getItem(this.storageKey(key)) ?? fallback; } catch { return fallback; }
  }
  persist(key, value) {
    try { localStorage.setItem(this.storageKey(key), String(value)); } catch { /* ignore */ }
  }
  remember(element, key, fallback = "") {
    if (!element) return element;
    element.value = this.restore(key, fallback);
    const save = () => this.persist(key, element.value);
    element.addEventListener("input", save);
    element.addEventListener("change", save);
    return element;
  }
  setOptions(select, values, current) {
    if (!select) return;
    const active = current ?? select.value;
    select.innerHTML = "";
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
    if (active && values.includes(active)) select.value = active;
  }
}
