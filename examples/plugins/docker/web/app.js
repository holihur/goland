const STYLE = `
  :host {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    font: 11px/1.5 "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
    color: CanvasText;
    background: Canvas;
  }
  .bar { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); }
  button {
    height: 26px; padding: 0 8px; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    border-radius: 4px; background: color-mix(in srgb, CanvasText 6%, transparent); color: inherit; cursor: pointer;
  }
  button:hover { background: color-mix(in srgb, CanvasText 12%, transparent); }
  button:disabled { opacity: .5; cursor: wait; }
  .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 8px; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); }
  label { display: flex; flex-direction: column; gap: 2px; color: color-mix(in srgb, CanvasText 60%, transparent); }
  input { height: 24px; padding: 0 6px; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 4px; background: transparent; color: inherit; font: inherit; }
  pre { flex: 1; min-height: 0; margin: 0; padding: 10px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
  .status { padding: 6px 10px; color: color-mix(in srgb, CanvasText 60%, transparent); border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); }
`;
const FIELDS = [
  ["service", "service", ""],
  ["file", "compose file", "docker-compose.yml"],
  ["container", "container", ""],
  ["image", "image tag", "app:latest"],
];

export const tagName = "goland-docker-console";

export default class DockerConsole extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._built = false;
    this._busy = false;
  }

  set api(value) {
    this._api = value;
    this.style.colorScheme = value?.theme === "dark" ? "dark" : "light";
    this.build();
  }

  get api() {
    return this._api;
  }

  connectedCallback() {
    this.build();
  }

  build() {
    if (this._built) return;
    this._built = true;
    const style = document.createElement("style");
    style.textContent = STYLE;
    const bar = document.createElement("div");
    bar.className = "bar";
    const fields = document.createElement("div");
    fields.className = "fields";
    this._inputs = {};
    for (const [key, label, value] of FIELDS) {
      const wrap = document.createElement("label");
      wrap.textContent = label;
      const input = document.createElement("input");
      input.value = value;
      input.placeholder = label;
      this._inputs[key] = input;
      wrap.append(input);
      fields.append(wrap);
    }
    const output = document.createElement("pre");
    output.textContent = "Run a Docker action.";
    this._output = output;
    const status = document.createElement("div");
    status.className = "status";
    status.textContent = "Docker";
    this._status = status;
    for (const [label, action] of [
      ["Containers", "ps"],
      ["Images", "images"],
      ["Compose up", "compose-up"],
      ["Compose down", "compose-down"],
      ["Compose logs", "compose-logs"],
      ["Container logs", "logs"],
      ["Build", "build"],
      ["Version", "version"],
    ]) {
      const button = document.createElement("button");
      button.textContent = label;
      button.addEventListener("click", () => this.run(action));
      bar.append(button);
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
      const result = await this._api.execute("docker.panel.run", inputs);
      this._output.textContent = result.output || "(no output)";
      this._status.textContent = `${action} finished`;
    } catch (err) {
      this._output.textContent = err instanceof Error ? err.message : String(err);
      this._status.textContent = "Docker command failed";
      this._api.notify("error", "Docker command failed");
    } finally {
      this._busy = false;
      this.shadowRoot.querySelectorAll("button").forEach((button) => (button.disabled = false));
    }
  }
}
