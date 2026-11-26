import { PluginConsole, icon } from "/plugin-ui.js";

const STYLES = `
  .docker-head { display: flex; align-items: center; gap: 8px; }
  .docker-head .pc-badge { margin-left: auto; font-family: "JetBrains Mono", monospace; letter-spacing: .04em; }
  .docker-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .docker-actions .pc-action { min-height: 40px; }
  .docker-actions .pc-action span { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .docker-actions .pc-action small { color: var(--pc-muted); font-size: 8px; font-weight: 400; }
  .docker-form-card[hidden] { display: none; }
  .docker-form-card .pc-grid { margin-top: 1px; }
  .docker-form-card .pc-actions { margin-top: 11px; }
  .docker-tip { display: flex; gap: 7px; align-items: flex-start; color: var(--pc-muted); font-size: 9px; line-height: 1.5; }
  .docker-tip .pc-icon { color: var(--pc-primary); margin-top: 1px; }
`;

const ACTIONS = [
  { id: "ps", label: "Containers", hint: "Running and stopped", icon: "container", simple: true },
  { id: "images", label: "Images", hint: "Local image cache", icon: "layers", simple: true },
  { id: "compose-up", label: "Compose up", hint: "Start services", icon: "play", form: true },
  { id: "compose-down", label: "Compose down", hint: "Stop services", icon: "stop", form: true },
  { id: "compose-logs", label: "Compose logs", hint: "Recent service logs", icon: "files", form: true },
  { id: "logs", label: "Container logs", hint: "Tail one container", icon: "terminal", form: true },
  { id: "build", label: "Build image", hint: "Build from context", icon: "layers", form: true },
  { id: "version", label: "Version", hint: "CLI information", icon: "server", simple: true },
];

const FORMS = {
  "compose-up": [["service", "Service (optional)", "api"], ["file", "Compose file", "docker-compose.yml"]],
  "compose-down": [["service", "Service (optional)", "api"], ["file", "Compose file", "docker-compose.yml"]],
  "compose-logs": [["service", "Service (optional)", "api"], ["file", "Compose file", "docker-compose.yml"]],
  logs: [["container", "Container", "my-app"]],
  build: [["image", "Image tag", "app:latest"], ["context", "Build context", "."], ["dockerfile", "Dockerfile", "Dockerfile"]],
};

export const tagName = "goland-docker-console";

export default class DockerConsole extends PluginConsole {
  static styles = STYLES;
  static storageKey = "docker-console";

  get consoleTitle() { return "Docker output"; }
  get emptyText() { return "Choose a quick action above, then inspect containers, images or Compose logs."; }
  get emptyIcon() { return "container"; }

  render() {
    return `
      <div class="pc-stack">
        <div class="pc-card">
          <div class="pc-card-head">
            ${icon("container", 13)} <span>Docker</span>
            <span class="pc-badge"><span class="pc-dot"></span> workspace CLI</span>
          </div>
          <div class="docker-actions">
            ${ACTIONS.map((action) => `
              <button class="pc-action" data-plugin-action data-docker-action="${action.id}" aria-pressed="false">
                ${icon(action.icon, 14)}
                <span><strong>${action.label}</strong><small>${action.hint}</small></span>
              </button>`).join("")}
          </div>
        </div>
        <div class="pc-card docker-form-card" data-docker-form-card hidden>
          <div class="pc-card-head">${icon("settings", 13)} <span data-docker-form-title>Options</span></div>
          <div class="pc-grid" data-docker-form></div>
          <div class="pc-actions end">
            <button class="pc-btn primary" data-plugin-action data-docker-run>${icon("play", 12)} Run</button>
          </div>
        </div>
        <div class="docker-tip">${icon("server", 13)}<span>Commands run with the workspace environment and Docker settings. Long-running actions stream into the output panel and can be stopped at any time.</span></div>
      </div>`;
  }

  bind() {
    this.$active = "ps";
    this.$formCard = this.shadowRoot.querySelector("[data-docker-form-card]");
    this.$form = this.shadowRoot.querySelector("[data-docker-form]");
    this.$formTitle = this.shadowRoot.querySelector("[data-docker-form-title]");
    this.shadowRoot.querySelector("[data-docker-run]").addEventListener("click", () => this.runActive());
    for (const button of this.shadowRoot.querySelectorAll("[data-docker-action]")) {
      button.addEventListener("click", () => this.choose(button.dataset.dockerAction));
    }
    this.choose("ps", false);
  }

  choose(action, run = true) {
    const definition = ACTIONS.find((item) => item.id === action);
    if (!definition) return;
    for (const button of this.shadowRoot.querySelectorAll("[data-docker-action]")) {
      button.setAttribute("aria-pressed", String(button.dataset.dockerAction === action));
    }
    this.$active = action;
    if (definition.simple) {
      this.$formCard.hidden = true;
      if (run) void this.runAction(action, definition);
      return;
    }
    this.$formCard.hidden = false;
    this.$formTitle.textContent = definition.label;
    this.renderForm(action);
  }

  renderForm(action) {
    const fields = FORMS[action] ?? [];
    this.$form.innerHTML = fields.map(([key, label, placeholder], index) => {
      const value = this.restore(`field.${key}`, placeholder);
      const wide = fields.length === 1 || index === 2 ? " span-2" : "";
      return `<label class="pc-field${wide}"><span>${label}</span><input class="pc-input" data-docker-input="${key}" value="${this.attr(value)}" placeholder="${placeholder}" spellcheck="false" /></label>`;
    }).join("") || '<div class="pc-help">No options required. Run to continue.</div>';
    for (const input of this.$form.querySelectorAll("[data-docker-input]")) {
      input.addEventListener("input", () => this.persist(`field.${input.dataset.dockerInput}`, input.value));
    }
  }

  attr(value) { return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"); }

  primaryAction() { void this.runActive(); }

  async runActive() {
    const definition = ACTIONS.find((item) => item.id === this.$active) ?? ACTIONS[0];
    if (definition.simple) return this.runAction(definition.id, definition);
    return this.runAction(definition.id, definition);
  }

  async runAction(action, definition = ACTIONS.find((item) => item.id === action)) {
    const inputs = { action };
    for (const input of this.shadowRoot.querySelectorAll("[data-docker-input]")) {
      inputs[input.dataset.dockerInput] = input.value;
    }
    const label = definition?.label ?? action;
    await this.run("docker.run", inputs, {
      label: `${label}…`,
      successLabel: `${label} finished`,
      errorLabel: `${label} failed`,
    });
  }
}
