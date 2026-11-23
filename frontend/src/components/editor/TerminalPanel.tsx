import { useEffect, useRef, useState } from "react";
import { Circle, Loader2, RotateCw, Trash2 } from "lucide-react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { terminalSocket } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TerminalPanel({
  workspaceId,
  visible,
}: {
  workspaceId: string;
  visible: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "closed" | "error">("connecting");
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 12,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      lineHeight: 1.35,
      scrollback: 5000,
      allowTransparency: true,
      theme: {
        background: "#0b0d10",
        foreground: "#d6dde8",
        cursor: "#7dd3fc",
        cursorAccent: "#0b0d10",
        selectionBackground: "#3b82f655",
        black: "#1a1f27",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e2e8f0",
        brightBlack: "#64748b",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    term.writeln("\x1b[38;5;244mConnecting to workspace terminal…\x1b[0m");

    let disposed = false;
    let reconnectTimer: number | undefined;
    let socket: WebSocket | null = null;

    const sendResize = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      try {
        fit.fit();
      } catch {
        // The panel can be hidden while the browser reports zero size.
      }
      socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    const connect = () => {
      if (disposed) return;
      setStatus("connecting");
      socket = new WebSocket(terminalSocket(workspaceId));
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        if (disposed) {
          socket?.close();
          return;
        }
        setStatus("connected");
        term.clear();
        window.setTimeout(sendResize, 30);
      };
      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data) as { type?: string; message?: string };
            if (message.type === "exit") term.writeln(`\r\n\x1b[38;5;244m[process exited]\x1b[0m`);
            if (message.type === "error" && message.message) {
              term.writeln(`\r\n\x1b[31m${message.message}\x1b[0m`);
            }
          } catch {
            term.write(event.data);
          }
          return;
        }
        const decoder = new TextDecoder();
        term.write(decoder.decode(event.data));
      };
      socket.onerror = () => setStatus("error");
      socket.onclose = () => {
        if (disposed) return;
        setStatus("closed");
        term.writeln("\r\n\x1b[38;5;244m[terminal disconnected]\x1b[0m");
      };
    };

    const dataSub = term.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });

    const resizeObserver = new ResizeObserver(() => {
      if (visible) sendResize();
    });
    resizeObserver.observe(container);

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      resizeObserver.disconnect();
      dataSub.dispose();
      socket?.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      socketRef.current = null;
    };
  }, [workspaceId, generation]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => {
      try {
        fitRef.current?.fit();
        const socket = socketRef.current;
        const term = termRef.current;
        if (socket?.readyState === WebSocket.OPEN && term) {
          socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {
        // ignore
      }
    }, 40);
    return () => window.clearTimeout(timer);
  }, [visible]);

  return (
    <div className="flex h-full flex-col bg-[#0b0d10]">
      <div className="flex h-8 shrink-0 items-center justify-between border-b px-2">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <Circle
              className={cn(
                "h-2 w-2",
                status === "connected" && "fill-emerald-400 text-emerald-400",
                status === "connecting" && "fill-amber-400 text-amber-400",
                (status === "closed" || status === "error") && "fill-red-400 text-red-400",
              )}
            />
            Terminal
          </span>
          <span className="font-code text-[10px] text-muted-foreground">{status}</span>
        </div>
        <div className="flex items-center">
          <Button variant="ghost" size="icon-sm" title="Clear" onClick={() => termRef.current?.clear()}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Reconnect"
            onClick={() => {
              socketRef.current?.close();
              setGeneration((value) => value + 1);
            }}
          >
            {status === "connecting" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}
