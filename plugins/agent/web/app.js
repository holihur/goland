import { PluginConsole, icon } from "/plugin-ui.js";

const STYLES = `
  :host([data-layout="chat"]) .pc-body { display: flex; padding: 0; overflow: hidden; }
  .agent { display: flex; flex: 1; flex-direction: column; min-height: 0; }
  .agent-toolbar { display: flex; align-items: flex-end; gap: 7px; padding: 10px 12px; border-bottom: 1px solid var(--pc-border); background: color-mix(in srgb, var(--pc-panel) 45%, transparent); }
  .agent-session { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
  .agent-session .pc-input { height: 28px; font-size: 10px; }
  .agent-session .pc-kicker { font-size: 8px; }
  .agent-toolbar .pc-btn { height: 28px; padding: 0 8px; font-size: 10px; }
  .agent-chat { flex: 1; min-height: 0; overflow: auto; padding: 14px 12px 18px; display: flex; flex-direction: column; gap: 14px; scroll-behavior: smooth; }
  .agent-empty { margin: auto; width: 100%; max-width: 340px; display: flex; flex-direction: column; align-items: center; gap: 9px; padding: 18px 8px; text-align: center; }
  .agent-empty-icon { display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid hsl(var(--primary) / .25); border-radius: 12px; color: var(--pc-primary); background: hsl(var(--primary) / .08); box-shadow: 0 0 0 5px hsl(var(--primary) / .035); }
  .agent-empty h2 { margin: 2px 0 0; font-size: 14px; font-weight: 600; letter-spacing: -.01em; }
  .agent-empty p { margin: 0; color: var(--pc-muted); font-size: 10px; line-height: 1.6; }
  .agent-suggestions { display: flex; flex-wrap: wrap; justify-content: center; gap: 5px; margin-top: 4px; }
  .agent-notice { margin: 0 12px; padding: 6px 9px; border: 1px solid var(--pc-border); border-radius: 7px; color: var(--pc-muted); font-size: 9px; background: color-mix(in srgb, var(--pc-panel) 50%, transparent); }
  .agent-notice[hidden] { display: none; }
  .msg { display: flex; flex-direction: column; gap: 4px; max-width: 100%; animation: msg-in .16s ease-out; }
  @keyframes msg-in { from { opacity: 0; transform: translateY(3px); } }
  .msg-head { display: flex; align-items: center; gap: 5px; color: var(--pc-muted); font-size: 8px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
  .msg-head .pc-icon { color: var(--pc-primary); }
  .msg.user { align-items: flex-end; }
  .msg.user .msg-head { color: var(--pc-muted); }
  .msg-text { width: fit-content; max-width: 94%; margin: 0; padding: 8px 10px; border: 1px solid var(--pc-border); border-radius: 9px; background: color-mix(in srgb, var(--pc-panel) 65%, transparent); color: var(--pc-fg); font: 11px/1.6 "JetBrains Mono", "SFMono-Regular", Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
  .msg.user .msg-text { border-color: hsl(var(--primary) / .25); border-bottom-right-radius: 3px; background: hsl(var(--primary) / .10); }
  .msg.assistant .msg-text { border-bottom-left-radius: 3px; }
  .msg.error .msg-text { border-color: color-mix(in srgb, var(--pc-danger) 35%, transparent); color: var(--pc-danger); background: color-mix(in srgb, var(--pc-danger) 8%, transparent); }
  .typing { display: inline-flex; gap: 3px; align-items: center; height: 18px; }
  .typing span { width: 4px; height: 4px; border-radius: 999px; background: var(--pc-muted); animation: typing 1s infinite ease-in-out; }
  .typing span:nth-child(2) { animation-delay: .12s; }
  .typing span:nth-child(3) { animation-delay: .24s; }
  @keyframes typing { 0%, 60%, 100% { opacity: .25; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }
  .composer { flex: none; padding: 9px 12px 11px; border-top: 1px solid var(--pc-border); background: color-mix(in srgb, var(--pc-panel) 66%, transparent); }
  .composer .pc-textarea { min-height: 62px; max-height: 160px; resize: none; font: 11px/1.55 "JetBrains Mono", "SFMono-Regular", Consolas, monospace; }
  .composer-foot { display: flex; align-items: center; gap: 6px; margin-top: 7px; }
  .composer-hint { flex: 1; color: var(--pc-muted); font-size: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .composer .pc-btn { height: 28px; font-size: 10px; }
  .composer .pc-btn.primary { min-width: 62px; }
`;

export const tagName = "goland-agent-console";

export default class AgentConsole extends PluginConsole {
  static styles = STYLES;
  static storageKey = "agent-console";

  get layout() { return "chat"; }
  get consoleEnabled() { return false; }

  render() {
    return `
      <div class="agent">
        <div class="agent-toolbar">
          <label class="agent-session">
            <span class="pc-kicker">Session</span>
            <input class="pc-input" data-agent="session" list="agent-sessions" placeholder="goland" spellcheck="false" />
            <datalist id="agent-sessions"></datalist>
          </label>
          <button class="pc-btn ghost" data-plugin-action data-agent="sessions" title="Load saved sessions">${icon("layers", 12)} Sessions</button>
          <button class="pc-btn ghost" data-plugin-action data-agent="new" title="Start a new session">${icon("plus", 12)} New</button>
          <button class="pc-btn ghost" data-agent="clear" title="Clear conversation" aria-label="Clear conversation">${icon("eraser", 12)}</button>
        </div>
        <div class="agent-notice" data-agent="notice" hidden></div>
        <div class="agent-chat" data-agent="chat">
          <div class="agent-empty" data-agent="empty">
            <div class="agent-empty-icon">${icon("sparkles", 20)}</div>
            <h2>Ask your workspace</h2>
            <p>The agent can read files and run approved tools. Credentials come from the workspace <code>.env</code> or plugin settings.</p>
            <div class="agent-suggestions">
              <button class="pc-chip" data-agent="suggest">Summarize this project</button>
              <button class="pc-chip" data-agent="suggest">Find the main entry point</button>
              <button class="pc-chip" data-agent="suggest">Review uncommitted changes</button>
            </div>
          </div>
        </div>
        <div class="composer">
          <textarea class="pc-textarea" data-agent="prompt" placeholder="Ask the workspace agent…" spellcheck="false"></textarea>
          <div class="composer-foot">
            <span class="composer-hint">⌘↵ to send · Esc to stop</span>
            <button class="pc-btn ghost" data-agent="configure">${icon("settings", 12)} Configure</button>
            <button class="pc-btn danger" data-agent="stop" hidden>${icon("stop", 12)} Stop</button>
            <button class="pc-btn primary" data-plugin-action data-agent="ask">${icon("send", 12)} Ask</button>
          </div>
        </div>
      </div>`;
  }

  bind() {
    this.$session = this.shadowRoot.querySelector('[data-agent="session"]');
    this.$prompt = this.shadowRoot.querySelector('[data-agent="prompt"]');
    this.$chat = this.shadowRoot.querySelector('[data-agent="chat"]');
    this.$empty = this.shadowRoot.querySelector('[data-agent="empty"]');
    this.$notice = this.shadowRoot.querySelector('[data-agent="notice"]');
    this.remember(this.$session, "session", "goland");

    this.shadowRoot.querySelector('[data-agent="ask"]').addEventListener("click", () => this.ask());
    this.$stop = this.shadowRoot.querySelector('[data-agent="stop"]');
    this.$stop.addEventListener("click", () => this.cancel());
    this.shadowRoot.querySelector('[data-agent="configure"]').addEventListener("click", () => this.configure());
    this.shadowRoot.querySelector('[data-agent="sessions"]').addEventListener("click", () => this.loadSessions());
    this.shadowRoot.querySelector('[data-agent="new"]').addEventListener("click", () => this.newSession());
    this.shadowRoot.querySelector('[data-agent="clear"]').addEventListener("click", () => this.clearChat());
    for (const button of this.shadowRoot.querySelectorAll('[data-agent="suggest"]')) {
      button.addEventListener("click", () => {
        this.$prompt.value = button.textContent.trim();
        this.$prompt.focus();
        this.resizePrompt();
      });
    }
    this.$prompt.addEventListener("input", () => this.resizePrompt());
  }

  _setBusyUI(busy) {
    super._setBusyUI(busy);
    if (this.$stop) this.$stop.hidden = !busy;
  }

  resizePrompt() {
    if (!this.$prompt) return;
    this.$prompt.style.height = "auto";
    this.$prompt.style.height = `${Math.min(this.$prompt.scrollHeight, 160)}px`;
  }

  primaryAction() { void this.ask(); }

  async ask() {
    const prompt = this.$prompt?.value.trim() ?? "";
    if (!prompt) {
      this.showError("Write a prompt before asking the agent.");
      this.$prompt?.focus();
      return;
    }
    this.showError("");
    this.$empty?.setAttribute("hidden", "");
    this.$notice.hidden = true;
    this.addMessage("user", prompt);
    const assistant = this.addMessage("assistant", "", true);
    const result = await this.run("agent.run", {
      action: "ask",
      prompt,
      session: this.$session.value.trim() || "goland",
    }, {
      output: false,
      label: "Agent is working…",
      successLabel: "Agent answered",
      errorLabel: "Agent failed",
      onChunk: (_chunk, full) => {
        assistant.classList.remove("typing-message");
        assistant.querySelector(".msg-text").textContent = full;
        this.scrollChat();
      },
      onResult: (response, streamed) => {
        const text = streamed || response.output || "(no output)";
        assistant.querySelector(".msg-text").textContent = text;
        this.scrollChat();
      },
      onError: (message) => {
        assistant.remove();
        this.addMessage("error", message);
      },
    });
    if (result) {
      this.$prompt.value = "";
      this.resizePrompt();
      this.$prompt.focus();
    }
  }

  async loadSessions() {
    if (!this._api) return;
    this.showError("");
    const result = await this.run("agent.run", {
      action: "sessions",
      session: this.$session.value.trim() || "goland",
    }, {
      output: false,
      label: "Loading sessions…",
      successLabel: "Sessions loaded",
      errorLabel: "Could not load sessions",
      onResult: (response) => {
        const text = (response.output || "").trim();
        const names = text === "No saved sessions." ? [] : text.split("\n").map((item) => item.trim()).filter(Boolean);
        this.setOptions(this.shadowRoot.querySelector("#agent-sessions"), names, this.$session.value);
        this.$notice.textContent = names.length ? `${names.length} saved session${names.length === 1 ? "" : "s"}. Pick one or type a new name.` : "No saved sessions yet. Your next question creates one.";
        this.$notice.hidden = false;
      },
      onError: (message) => {
        this.$notice.textContent = message;
        this.$notice.hidden = false;
      },
    });
    if (result) this.$notice.hidden = false;
  }

  clearChat() {
    for (const message of this.shadowRoot.querySelectorAll(".msg")) message.remove();
    this.$empty?.removeAttribute("hidden");
    this.$notice.hidden = true;
    this.showError("");
    this.$prompt.focus();
  }

  newSession() {
    const name = `session-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").slice(0, 12)}`;
    this.$session.value = name;
    this.persist("session", name);
    this.$notice.textContent = `New session “${name}” will be created on the next question.`;
    this.$notice.hidden = false;
    this.$prompt.focus();
  }

  addMessage(role, text, typing = false) {
    const message = document.createElement("div");
    message.className = `msg ${role}${typing ? " typing-message" : ""}`;
    const head = document.createElement("div");
    head.className = "msg-head";
    head.innerHTML = role === "assistant" ? `${icon("sparkles", 10)} Agent` : role === "error" ? `${icon("alert", 10)} Error` : "You";
    const body = document.createElement("pre");
    body.className = "msg-text";
    if (typing) {
      body.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
    } else {
      body.textContent = text;
    }
    message.append(head, body);
    this.$chat.append(message);
    this.scrollChat();
    return message;
  }

  scrollChat() {
    if (this.$chat) this.$chat.scrollTop = this.$chat.scrollHeight;
  }
}
