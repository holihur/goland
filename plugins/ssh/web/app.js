const STYLE = `
  :host { display:flex; flex-direction:column; height:100%; min-height:0; font:11px/1.5 "JetBrains Mono","SFMono-Regular",Consolas,monospace; color:CanvasText; background:Canvas; }
  .bar { display:flex; flex-wrap:wrap; gap:4px; padding:8px; border-bottom:1px solid color-mix(in srgb, CanvasText 16%, transparent); }
  button { height:26px; padding:0 8px; border:1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius:4px; background:color-mix(in srgb, CanvasText 6%, transparent); color:inherit; cursor:pointer; }
  button:hover { background:color-mix(in srgb, CanvasText 12%, transparent); }
  button:disabled { opacity:.5; cursor:wait; }
  .fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; padding:8px; border-bottom:1px solid color-mix(in srgb, CanvasText 16%, transparent); }
  label { display:flex; flex-direction:column; gap:2px; color:color-mix(in srgb, CanvasText 60%, transparent); }
  input { height:24px; padding:0 6px; border:1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius:4px; background:transparent; color:inherit; font:inherit; }
  .wide { grid-column:1 / -1; }
  pre { flex:1; min-height:0; margin:0; padding:10px; overflow:auto; white-space:pre-wrap; word-break:break-word; }
  .status { padding:6px 10px; color:color-mix(in srgb, CanvasText 60%, transparent); border-bottom:1px solid color-mix(in srgb, CanvasText 16%, transparent); }
`;
const FIELDS = [
  ["host", "host", "example.com or config alias"],
  ["user", "user", "deploy"],
  ["port", "port", "22"],
  ["identity", "identity file", "~/.ssh/id_ed25519"],
];

export const tagName = "goland-ssh-console";

export default class SSHConsole extends HTMLElement {
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
      const input = document.createElement("input"); input.placeholder = placeholder; input.value = key === "port" ? "22" : "";
      this._inputs[key] = input; wrap.append(input); fields.append(wrap);
    }
    const commandWrap = document.createElement("label"); commandWrap.className = "wide"; commandWrap.textContent = "command";
    const command = document.createElement("input"); command.placeholder = "uptime; df -h";
    this._inputs.command = command; commandWrap.append(command); fields.append(commandWrap);
    const status = document.createElement("div"); status.className = "status"; status.textContent = "SSH";
    const output = document.createElement("pre"); output.textContent = "Test a connection or run a command.";
    this._status = status; this._output = output;
    for (const [label, action] of [["Test connection", "test"], ["Run command", "exec"], ["Config hosts", "hosts"]]) {
      const button = document.createElement("button"); button.textContent = label; button.dataset.action = action; button.addEventListener("click", () => this.run(action)); bar.append(button);
    }
    const cancel = document.createElement("button"); cancel.textContent = "Cancel"; cancel.hidden = true; cancel.addEventListener("click", () => this.cancel()); bar.append(cancel);
    this._cancelButton = cancel;
    this.shadowRoot.replaceChildren(style, bar, fields, status, output);
  }
  async run(action) {
    if (!this._api || this._busy) return;
    this._busy = true;
    this._requestId = "";
    this._streamed = "";
    this._output.textContent = "";
    this.shadowRoot.querySelectorAll("button[data-action]").forEach((button) => (button.disabled = true));
    this._cancelButton.hidden = false;
    this._status.textContent = `Running ${action}…`;
    this._api.setStatus?.(this._status.textContent, "running");
    try {
      const inputs = { action };
      for (const [key, input] of Object.entries(this._inputs)) inputs[key] = input.value;
      const result = await this._api.execute("ssh.run", inputs, {
        onRequest: (requestId) => { this._requestId = requestId; },
        onChunk: (chunk) => {
          this._streamed += chunk;
          this._output.textContent = this._streamed;
          this._output.scrollTop = this._output.scrollHeight;
        },
      });
      if (!this._streamed) this._output.textContent = result.output || "(no output)";
      this._status.textContent = `${action} finished`;
      this._api.setStatus?.(this._status.textContent, "success");
    } catch (err) {
      this._output.textContent = err instanceof Error ? err.message : String(err);
      this._status.textContent = "SSH command failed";
      this._api.setStatus?.("SSH command failed", "error");
      this._api.notify("error", "SSH command failed");
    } finally {
      this._busy = false;
      this._cancelButton.hidden = true;
      this.shadowRoot.querySelectorAll("button[data-action]").forEach((button) => (button.disabled = false));
    }
  }

  async cancel() {
    if (!this._requestId || !this._api) return;
    this._status.textContent = "Cancelling…";
    this._api.setStatus?.("Cancelling…", "running");
    try { await this._api.cancel(this._requestId); } catch {}
  }

}
