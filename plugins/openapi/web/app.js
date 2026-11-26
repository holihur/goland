import { PluginConsole, icon } from "/plugin-ui.js";

const STYLES = `
  .oa-tabs { display: flex; gap: 3px; padding: 3px; border: 1px solid var(--pc-border); border-radius: 8px; background: color-mix(in srgb, var(--pc-panel) 55%, transparent); }
  .oa-tab { flex: 1; height: 27px; border: 0; border-radius: 6px; background: transparent; color: var(--pc-muted); font: inherit; font-size: 10px; font-weight: 500; cursor: pointer; }
  .oa-tab:hover { color: var(--pc-fg); }
  .oa-tab[aria-selected="true"] { background: var(--pc-accent); color: var(--pc-fg); box-shadow: 0 1px 2px hsl(0 0% 0% / .12); }
  .oa-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
  .oa-grid .span-2 { grid-column: 1 / -1; }
  .oa-request-head { display: flex; align-items: center; gap: 7px; }
  .oa-request-head .pc-badge { margin-left: auto; font-family: "JetBrains Mono", monospace; }
  .oa-tip { display: flex; gap: 7px; align-items: flex-start; color: var(--pc-muted); font-size: 9px; line-height: 1.5; }
  .oa-tip .pc-icon { color: var(--pc-primary); margin-top: 1px; }
  .oa-actions { display: flex; align-items: center; gap: 7px; margin-top: 11px; }
  .oa-actions .pc-btn.primary { margin-left: auto; }
  @media (max-width: 360px) { .oa-grid { grid-template-columns: 1fr; } .oa-grid .span-2 { grid-column: auto; } }
`;

const TABS = [
  { id: "overview", label: "Overview", command: "openapi.run", action: "overview", hint: "Summarize the spec" },
  { id: "endpoints", label: "Endpoints", command: "openapi.run", action: "endpoints", hint: "List every operation" },
  { id: "validate", label: "Validate", command: "openapi.run", action: "validate", hint: "Check the document" },
  { id: "request", label: "Request", command: "openapi.run", action: "request", hint: "Send a live request" },
];

export const tagName = "goland-openapi-console";

export default class OpenAPIConsole extends PluginConsole {
  static styles = STYLES;
  static storageKey = "openapi-console";

  get consoleTitle() { return "OpenAPI output"; }
  get emptyText() { return "Load a spec, inspect endpoints, validate it or send a test request."; }
  get emptyIcon() { return "braces"; }

  render() {
    return `
      <div class="pc-stack">
        <div class="oa-tabs" role="tablist">
          ${TABS.map((tab) => `<button class="oa-tab" role="tab" data-oa-tab="${tab.id}" aria-selected="${tab.id === "overview"}">${tab.label}</button>`).join("")}
        </div>
        <div data-oa-content></div>
        <div class="oa-tip">${icon("files", 13)}<span>Spec paths are resolved inside this workspace. Request headers and body are sent to the configured base URL.</span></div>
      </div>`;
  }

  bind() {
    this.$content = this.shadowRoot.querySelector("[data-oa-content]");
    this.$active = "overview";
    for (const button of this.shadowRoot.querySelectorAll("[data-oa-tab]")) {
      button.addEventListener("click", () => this.selectTab(button.dataset.oaTab));
    }
    this.renderTab();
  }

  selectTab(tab) {
    this.$active = tab;
    for (const button of this.shadowRoot.querySelectorAll("[data-oa-tab]")) {
      button.setAttribute("aria-selected", String(button.dataset.oaTab === tab));
    }
    this.renderTab();
  }

  renderTab() {
    const tab = TABS.find((item) => item.id === this.$active) ?? TABS[0];
    const spec = this.attr(this.restore("spec", "openapi.yaml"));
    const baseUrl = this.attr(this.restore("baseUrl", ""));
    const method = this.restore("method", "GET");
    const path = this.attr(this.restore("path", "/pets"));
    const headers = this.attr(this.restore("headers", ""));
    const body = this.attr(this.restore("body", ""));
    const specField = `<label class="pc-field span-2"><span>Spec file</span><input class="pc-input" data-oa="spec" value="${spec}" placeholder="openapi.yaml" spellcheck="false" /></label>`;
    if (tab.id === "request") {
      this.$content.innerHTML = `
        <div class="pc-card">
          <div class="pc-card-head oa-request-head">${icon("send", 13)} <span>Request builder</span><span class="pc-badge">${method}</span></div>
          <div class="oa-grid">
            ${specField}
            <label class="pc-field"><span>Method</span><select class="pc-select" data-oa="method">${["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((item) => `<option ${item === method ? "selected" : ""}>${item}</option>`).join("")}</select></label>
            <label class="pc-field"><span>Path</span><input class="pc-input" data-oa="path" value="${path}" placeholder="/pets" spellcheck="false" /></label>
            <label class="pc-field span-2"><span>Base URL</span><input class="pc-input" data-oa="baseUrl" value="${baseUrl}" placeholder="https://api.example.com" spellcheck="false" /></label>
            <label class="pc-field span-2"><span>Headers (JSON)</span><textarea class="pc-textarea" data-oa="headers" placeholder='{"Authorization":"Bearer …"}'>${headers}</textarea></label>
            <label class="pc-field span-2"><span>JSON body</span><textarea class="pc-textarea" data-oa="body" placeholder='{"name":"Ada"}'>${body}</textarea></label>
          </div>
          <div class="oa-actions"><span class="pc-help">${tab.hint}</span><button class="pc-btn primary" data-plugin-action data-oa-run>${icon("send", 12)} Send request</button></div>
        </div>`;
    } else {
      this.$content.innerHTML = `
        <div class="pc-card">
          <div class="pc-card-head">${icon("files", 13)} <span>${tab.label}</span></div>
          <div class="oa-grid">${specField}</div>
          <div class="oa-actions"><span class="pc-help">${tab.hint}</span><button class="pc-btn primary" data-plugin-action data-oa-run>${icon(tab.id === "validate" ? "check" : "play", 12)} Run</button></div>
        </div>`;
    }
    for (const input of this.$content.querySelectorAll("[data-oa]")) {
      input.addEventListener("input", () => this.persist(input.dataset.oa, input.value));
      input.addEventListener("change", () => this.persist(input.dataset.oa, input.value));
    }
    this.$content.querySelector("[data-oa-run]").addEventListener("click", () => this.runActive());
  }

  attr(value) { return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"); }

  primaryAction() { void this.runActive(); }

  async runActive() {
    const tab = TABS.find((item) => item.id === this.$active) ?? TABS[0];
    const inputs = { action: tab.action };
    for (const input of this.$content.querySelectorAll("[data-oa]")) inputs[input.dataset.oa] = input.value;
    await this.run("openapi.run", inputs, {
      label: `${tab.hint}…`,
      successLabel: `${tab.label} finished`,
      errorLabel: `${tab.label} failed`,
    });
  }

  normalizeOutput(value) {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
}
