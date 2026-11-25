const STYLE = `
  :host { display:flex; flex-direction:column; height:100%; min-height:0; font:11px/1.5 "JetBrains Mono","SFMono-Regular",Consolas,monospace; color:CanvasText; background:Canvas; }
  .bar { display:flex; flex-wrap:wrap; gap:4px; padding:8px; border-bottom:1px solid color-mix(in srgb, CanvasText 16%, transparent); }
  button { height:26px; padding:0 8px; border:1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius:4px; background:color-mix(in srgb, CanvasText 6%, transparent); color:inherit; cursor:pointer; }
  button:hover { background:color-mix(in srgb, CanvasText 12%, transparent); }
  button:disabled { opacity:.5; cursor:wait; }
  .fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; padding:8px; border-bottom:1px solid color-mix(in srgb, CanvasText 16%, transparent); }
  label { display:flex; flex-direction:column; gap:2px; color:color-mix(in srgb, CanvasText 60%, transparent); }
  input, select, textarea { padding:4px 6px; border:1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius:4px; background:transparent; color:inherit; font:inherit; }
  input, select { height:24px; }
  textarea { min-height:56px; resize:vertical; }
  .wide { grid-column:1 / -1; }
  pre { flex:1; min-height:0; margin:0; padding:10px; overflow:auto; white-space:pre-wrap; word-break:break-word; }
  .status { padding:6px 10px; color:color-mix(in srgb, CanvasText 60%, transparent); border-bottom:1px solid color-mix(in srgb, CanvasText 16%, transparent); }
`;
const FIELDS = [
  ["spec", "spec file", "openapi.yaml"],
  ["baseUrl", "base URL", "https://api.example.com"],
  ["method", "method", "GET"],
  ["path", "path", "/pets"],
];

export const tagName = "goland-openapi-console";

export default class OpenAPIConsole extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._built = false; this._busy = false; }
  set api(value) { this._api = value; this.style.colorScheme = value?.theme === "dark" ? "dark" : "light"; this.build(); }
  get api() { return this._api; }
  connectedCallback() { this.build(); }
  build() {
    if (this._built) return;
    this._built = true;
    const style = document.createElement("style"); style.textContent = STYLE;
    const bar = document.createElement("div"); bar.className = "bar";
    const fields = document.createElement("div"); fields.className = "fields";
    this._inputs = {};
    for (const [key, label, placeholder] of FIELDS) {
      const wrap = document.createElement("label"); wrap.textContent = label;
      let input;
      if (key === "method") {
        input = document.createElement("select");
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
          const option = document.createElement("option"); option.value = method; option.textContent = method; input.append(option);
        }
      } else {
        input = document.createElement("input"); input.placeholder = placeholder;
      }
      this._inputs[key] = input; wrap.append(input); fields.append(wrap);
    }
    for (const [key, label, placeholder] of [["headers", "headers (JSON)", '{"Authorization":"Bearer …"}'], ["body", "JSON body", '{"name":"Ada"}']]) {
      const wrap = document.createElement("label"); wrap.className = "wide"; wrap.textContent = label;
      const input = document.createElement("textarea"); input.placeholder = placeholder;
      this._inputs[key] = input; wrap.append(input); fields.append(wrap);
    }
    const status = document.createElement("div"); status.className = "status"; status.textContent = "OpenAPI";
    const output = document.createElement("pre"); output.textContent = "Inspect a spec or send a request.";
    this._status = status; this._output = output;
    for (const [label, action] of [["Overview", "overview"], ["Endpoints", "endpoints"], ["Validate", "validate"], ["Send request", "request"]]) {
      const button = document.createElement("button"); button.textContent = label; button.addEventListener("click", () => this.run(action)); bar.append(button);
    }
    this.shadowRoot.replaceChildren(style, bar, fields, status, output);
  }
  async run(action) {
    if (!this._api || this._busy) return;
    this._busy = true;
    this.shadowRoot.querySelectorAll("button").forEach((button) => (button.disabled = true));
    this._status.textContent = `Running ${action}…`;
    try {
      const inputs = { action };
      for (const [key, input] of Object.entries(this._inputs)) inputs[key] = input.value;
      const result = await this._api.execute("openapi.panel.run", inputs);
      this._output.textContent = result.output || "(no output)";
      this._status.textContent = `${action} finished`;
    } catch (err) {
      this._output.textContent = err instanceof Error ? err.message : String(err);
      this._status.textContent = "OpenAPI command failed";
      this._api.notify("error", "OpenAPI command failed");
    } finally {
      this._busy = false;
      this.shadowRoot.querySelectorAll("button").forEach((button) => (button.disabled = false));
    }
  }
}
