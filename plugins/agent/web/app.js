const STYLE = `
  :host { display:flex; flex-direction:column; height:100%; min-height:0; font:11px/1.5 "JetBrains Mono","SFMono-Regular",Consolas,monospace; color:CanvasText; background:Canvas; }
  .bar { display:flex; gap:4px; padding:8px; border-bottom:1px solid color-mix(in srgb, CanvasText 16%, transparent); }
  button { height:26px; padding:0 8px; border:1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius:4px; background:color-mix(in srgb, CanvasText 6%, transparent); color:inherit; cursor:pointer; }
  button:hover { background:color-mix(in srgb, CanvasText 12%, transparent); }
  button:disabled { opacity:.5; cursor:wait; }
  .fields { display:grid; gap:6px; padding:8px; border-bottom:1px solid color-mix(in srgb, CanvasText 16%, transparent); }
  label { display:flex; flex-direction:column; gap:3px; color:color-mix(in srgb, CanvasText 60%, transparent); }
  input, textarea { padding:6px; border:1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius:4px; background:transparent; color:inherit; font:inherit; }
  input { height:26px; }
  textarea { min-height:74px; resize:vertical; }
  pre { flex:1; min-height:0; margin:0; padding:10px; overflow:auto; white-space:pre-wrap; word-break:break-word; }
  .status { padding:6px 10px; color:color-mix(in srgb, CanvasText 60%, transparent); border-bottom:1px solid color-mix(in srgb, CanvasText 16%, transparent); }
`;
export const tagName = "goland-agent-console";

export default class AgentConsole extends HTMLElement {
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
    const sessionLabel = document.createElement("label"); sessionLabel.textContent = "session";
    const session = document.createElement("input"); session.value = "goland"; session.placeholder = "session name";
    sessionLabel.append(session);
    const promptLabel = document.createElement("label"); promptLabel.textContent = "prompt";
    const prompt = document.createElement("textarea"); prompt.placeholder = "Ask the workspace agent…";
    promptLabel.append(prompt);
    fields.append(sessionLabel, promptLabel);
    const status = document.createElement("div"); status.className = "status"; status.textContent = "Agent";
    const output = document.createElement("pre"); output.textContent = "Ask the local agent about this workspace.";
    this._session = session; this._prompt = prompt; this._status = status; this._output = output;
    for (const [label, action] of [["Ask", "ask"], ["Sessions", "sessions"]]) {
      const button = document.createElement("button"); button.textContent = label; button.dataset.action = action; button.addEventListener("click", () => this.run(action)); bar.append(button);
    }
    const cancel = document.createElement("button"); cancel.textContent = "Cancel"; cancel.hidden = true; cancel.addEventListener("click", () => this.cancel()); bar.append(cancel);
    this._cancelButton = cancel;
    this.shadowRoot.replaceChildren(style, bar, fields, status, output);
  }
  async run(action) {
    if (!this._api || this._busy) return;
    if (action === "ask" && !this._prompt.value.trim()) {
      this._status.textContent = "Prompt is required";
      this._api.setStatus?.("Prompt is required", "error");
      return;
    }
    this._busy = true;
    this._requestId = "";
    this._streamed = "";
    this._output.textContent = "";
    this.shadowRoot.querySelectorAll("button[data-action]").forEach((button) => (button.disabled = true));
    this._cancelButton.hidden = false;
    this._status.textContent = action === "sessions" ? "Loading sessions…" : "Agent is working…";
    this._api.setStatus?.(this._status.textContent, "running");
    try {
      const result = await this._api.execute("agent.run", {
        action, prompt: this._prompt.value, session: this._session.value,
      }, {
        onRequest: (requestId) => { this._requestId = requestId; },
        onChunk: (chunk) => {
          this._streamed += chunk;
          this._output.textContent = this._streamed;
          this._output.scrollTop = this._output.scrollHeight;
        },
      });
      if (!this._streamed) this._output.textContent = result.output || "(no output)";
      this._status.textContent = action === "sessions" ? "Sessions loaded" : "Agent finished";
      this._api.setStatus?.(this._status.textContent, "success");
    } catch (err) {
      this._output.textContent = err instanceof Error ? err.message : String(err);
      this._status.textContent = "Agent failed";
      this._api.setStatus?.("Agent failed", "error");
      this._api.notify("error", "Agent command failed");
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
