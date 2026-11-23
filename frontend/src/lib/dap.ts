import { debugSocket } from "./api";

export type DAPEvent = {
  event: string;
  body?: Record<string, unknown>;
};

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: number;
};

export interface StackFrame {
  id: number;
  name: string;
  source?: { name?: string; path?: string };
  line: number;
  column: number;
}

export interface Scope {
  name: string;
  variablesReference: number;
  expensive: boolean;
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export class DAPClient {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(event: DAPEvent) => void>();
  private closed = false;
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  adapterId = "";
  private onStartDebugging?: (configuration: Record<string, unknown>) => Promise<void>;
  private ignoreStartDebugging = false;

  constructor(
    private workspaceId: string,
    private kind: "go" | "node" | "browser",
    private onError: (message: string) => void,
    adapterId = "",
  ) {
    this.adapterId = adapterId;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.connect();
  }

  private connect() {
    const socket = new WebSocket(debugSocket(this.workspaceId, this.kind, this.adapterId));
    this.socket = socket;
    socket.onopen = () => this.resolveReady();
    socket.onerror = () => {
      if (this.closed) return;
      this.onError(`${this.kind} debug adapter connection failed`);
      this.rejectReady(new Error("debug adapter connection failed"));
    };
    socket.onclose = () => {
      if (this.closed) return;
      this.closed = true;
      for (const [, item] of this.pending) {
        window.clearTimeout(item.timer);
        item.reject(new Error("debug adapter closed"));
      }
      this.pending.clear();
      this.emit({ event: "goland/closed" });
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        this.handle(JSON.parse(event.data));
      } catch {
        // Ignore malformed frames.
      }
    };
  }

  private handle(message: Record<string, unknown>) {
    if (import.meta.env.DEV) console.debug("[dap]", message.type, message.command ?? message.event ?? message.request_seq, message.type === "request" ? JSON.stringify(message.arguments) : "");
    if (message.type === "response") {
      const requestSeq = Number(message.request_seq);
      const item = this.pending.get(requestSeq);
      if (!item) return;
      this.pending.delete(requestSeq);
      window.clearTimeout(item.timer);
      if (message.success === false) {
        item.reject(new Error(String(message.message ?? "debug request failed")));
      } else {
        item.resolve((message.body as Record<string, unknown>) ?? {});
      }
      return;
    }
    if (message.type === "request") {
      void this.handleServerRequest(Number(message.seq), String(message.command ?? ""), (message.arguments as Record<string, unknown>) ?? {});
      return;
    }
    if (message.type === "event") {
      const body = (message.body as Record<string, unknown>) ?? {};
      if (message.event === "goland/adapter") this.adapterId = String(body.id ?? "");
      this.emit({ event: String(message.event ?? ""), body });
      if (message.event === "initialized") this.resolveReady();
    }
  }

  private async handleServerRequest(seq: number, command: string, args: Record<string, unknown> = {}) {
    let body: Record<string, unknown> = {};
    let success = true;
    if (command === "runInTerminal") {
      body = { processId: 0, shellProcessId: 0 };
    } else if (command === "startDebugging") {
      if (this.ignoreStartDebugging) return;
      try {
        const configuration = (args.configuration as Record<string, unknown>) ?? {};
        await this.onStartDebugging?.(configuration);
      } catch (err) {
        success = false;
        this.onError(err instanceof Error ? err.message : "child debug session failed");
      }
    }
    this.send({ seq: ++this.sequence, type: "response", request_seq: seq, success, command, body });
  }

  onChildSession(handler: (configuration: Record<string, unknown>) => Promise<void>) {
    this.onStartDebugging = handler;
  }

  ignoreStartDebuggingRequests() {
    this.ignoreStartDebugging = true;
  }

  private send(message: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private emit(event: DAPEvent) {
    for (const listener of this.listeners) listener(event);
  }

  onEvent(listener: (event: DAPEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(command: string, args: Record<string, unknown> = {}, timeout = 20000): Promise<Record<string, unknown>> {
    return this.ready.then(
      () =>
        new Promise((resolve, reject) => {
          const seq = ++this.sequence;
          const timer = window.setTimeout(() => {
            this.pending.delete(seq);
            reject(new Error(`${command} timed out`));
          }, timeout);
          this.pending.set(seq, { resolve, reject, timer });
          this.send({ seq, type: "request", command, arguments: args });
        }),
    );
  }

  private initialized = false;

  async initializeSession() {
    if (this.initialized) return;
    this.initialized = true;
    await this.request("initialize", {
      clientID: "goland-web",
      clientName: "Goland Web IDE",
      adapterID: "goland",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: true,
      supportsMemoryReferences: false,
      supportsProgressReporting: false,
      supportsInvalidatedEvent: false,
      supportsSetExpression: true,
      supportsTerminateRequest: true,
      supportsStartDebuggingRequest: this.kind !== "browser",
    });
    await new Promise<void>((resolve) => {
      const off = this.onEvent((event) => {
        if (event.event === "initialized") {
          off();
          resolve();
        }
      });
      window.setTimeout(() => {
        off();
        resolve();
      }, 2500);
    });
  }

  async launch(config: Record<string, unknown>, beforeConfigurationDone?: () => Promise<void>) {
    await this.initializeSession();
    const launchPromise = this.request("launch", config, 180000);
    if (beforeConfigurationDone) await beforeConfigurationDone();
    await this.request("configurationDone", {});
    return launchPromise;
  }

  setBreakpoints(path: string, lines: number[]) {
    return this.request("setBreakpoints", {
      source: { path, name: path.split("/").pop() },
      breakpoints: lines.map((line) => ({ line })),
      lines,
      sourceModified: false,
    }, 180000);
  }

  setExceptionBreakpoints(filters: string[] = []) {
    return this.request("setExceptionBreakpoints", { filters }, 180000);
  }

  stackTrace(threadId: number) {
    return this.request("stackTrace", { threadId, startFrame: 0, levels: 30 });
  }

  scopes(frameId: number) {
    return this.request("scopes", { frameId });
  }

  variables(variablesReference: number) {
    return this.request("variables", { variablesReference });
  }

  evaluate(expression: string, frameId?: number) {
    return this.request("evaluate", { expression, frameId, context: "repl" });
  }

  continue(threadId: number) {
    return this.request("continue", { threadId });
  }

  next(threadId: number) {
    return this.request("next", { threadId });
  }

  stepIn(threadId: number) {
    return this.request("stepIn", { threadId });
  }

  stepOut(threadId: number) {
    return this.request("stepOut", { threadId });
  }

  pause(threadId: number) {
    return this.request("pause", { threadId });
  }

  disconnect(terminateDebuggee = true) {
    this.closed = true;
    this.send({
      seq: ++this.sequence,
      type: "request",
      command: "disconnect",
      arguments: { terminateDebuggee, restart: false },
    });
    window.setTimeout(() => this.socket?.close(), 300);
  }

  dispose() {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }
}
