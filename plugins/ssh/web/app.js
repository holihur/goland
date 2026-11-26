import { PluginConsole, icon } from "/plugin-ui.js";

const STYLES = `
  .ssh-grid { display: grid; grid-template-columns: 1.35fr .8fr; gap: 9px; }
  .ssh-grid .span-full { grid-column: 1 / -1; }
  .ssh-presets { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 3px; }
  .ssh-tip { display: flex; gap: 7px; align-items: flex-start; color: var(--pc-muted); font-size: 9px; line-height: 1.5; }
  .ssh-tip .pc-icon { color: var(--pc-primary); margin-top: 1px; }
  .ssh-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
  .ssh-actions .pc-btn.primary { margin-left: auto; }
  @media (max-width: 360px) { .ssh-grid { grid-template-columns: 1fr; } .ssh-grid .span-full { grid-column: auto; } }
`;

const PRESETS = ["uptime", "df -h", "whoami", "docker ps"];

export const tagName = "goland-ssh-console";

export default class SSHConsole extends PluginConsole {
  static styles = STYLES;
  static storageKey = "ssh-console";

  get consoleTitle() { return "SSH output"; }
  get emptyText() { return "Test a connection or run a non-interactive command to see output here."; }
  get emptyIcon() { return "network"; }

  render() {
    return `
      <div class="pc-stack">
        <div class="pc-card">
          <div class="pc-card-head">${icon("network", 13)} <span>Connection</span></div>
          <div class="ssh-grid">
            <label class="pc-field"><span>Host</span><input class="pc-input" data-ssh="host" placeholder="example.com or config alias" spellcheck="false" /></label>
            <label class="pc-field"><span>User</span><input class="pc-input" data-ssh="user" placeholder="deploy" spellcheck="false" /></label>
            <label class="pc-field"><span>Port</span><input class="pc-input" data-ssh="port" placeholder="22" inputmode="numeric" spellcheck="false" /></label>
            <label class="pc-field"><span>Identity file</span><input class="pc-input" data-ssh="identity" placeholder="~/.ssh/id_ed25519" spellcheck="false" /></label>
          </div>
        </div>
        <div class="pc-card">
          <div class="pc-card-head">${icon("terminal", 13)} <span>Command</span></div>
          <label class="pc-field span-full"><span>Run a non-interactive command on the host</span><input class="pc-input" data-ssh="command" placeholder="uptime; df -h" spellcheck="false" /></label>
          <div class="ssh-presets">
            ${PRESETS.map((preset) => `<button class="pc-chip" data-ssh-preset="${preset}">${preset}</button>`).join("")}
          </div>
          <div class="ssh-actions">
            <button class="pc-btn ghost" data-plugin-action data-ssh-action="hosts">${icon("files", 12)} Config hosts</button>
            <button class="pc-btn ghost" data-plugin-action data-ssh-action="test">${icon("check", 12)} Test connection</button>
            <button class="pc-btn primary" data-plugin-action data-ssh-action="exec">${icon("send", 12)} Run command</button>
          </div>
        </div>
        <div class="ssh-tip">${icon("network", 13)}<span>Non-interactive SSH only. Authentication uses your SSH agent, identity file or SSH config; password prompts are not supported.</span></div>
      </div>`;
  }

  bind() {
    this.$host = this.shadowRoot.querySelector('[data-ssh="host"]');
    this.$user = this.shadowRoot.querySelector('[data-ssh="user"]');
    this.$port = this.shadowRoot.querySelector('[data-ssh="port"]');
    this.$identity = this.shadowRoot.querySelector('[data-ssh="identity"]');
    this.$command = this.shadowRoot.querySelector('[data-ssh="command"]');
    this.remember(this.$host, "host");
    this.remember(this.$user, "user");
    this.remember(this.$port, "port", "22");
    this.remember(this.$identity, "identity");
    this.remember(this.$command, "command");
    for (const button of this.shadowRoot.querySelectorAll("[data-ssh-action]")) {
      button.addEventListener("click", () => this.runAction(button.dataset.sshAction));
    }
    for (const button of this.shadowRoot.querySelectorAll("[data-ssh-preset]")) {
      button.addEventListener("click", () => {
        this.$command.value = button.dataset.sshPreset;
        this.persist("command", this.$command.value);
        this.$command.focus();
      });
    }
  }

  primaryAction() { void this.runAction(this.$command?.value.trim() ? "exec" : "test"); }

  async runAction(action) {
    const label = action === "hosts" ? "SSH config hosts" : action === "test" ? "Connection test" : "Command";
    await this.run("ssh.run", {
      action,
      host: this.$host.value,
      user: this.$user.value,
      port: this.$port.value,
      identity: this.$identity.value,
      command: this.$command.value,
    }, {
      label: `${label}…`,
      successLabel: action === "test" ? "Connection OK" : `${label} finished`,
      errorLabel: `${label} failed`,
    });
  }
}
