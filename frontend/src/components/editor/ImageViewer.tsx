import { useState } from "react";
import { Download, Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ImageViewer({ workspaceId, path, name }: { workspaceId: string; path: string; name: string }) {
  const src = api.rawFileUrl(workspaceId, path);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [dimensions, setDimensions] = useState("");
  const [error, setError] = useState(false);

  const changeZoom = (next: number) => {
    setFit(false);
    setZoom(Math.min(8, Math.max(0.1, next)));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-panel/40 px-3 text-[10px] text-muted-foreground">
        <span className="min-w-0 truncate font-code">{name}</span>
        {dimensions && <span className="shrink-0">{dimensions}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          <button className="grid h-6 w-6 place-items-center rounded hover:bg-accent" title="Zoom out" aria-label="Zoom out" onClick={() => changeZoom(zoom / 1.25)}>
            <Minus className="h-3 w-3" />
          </button>
          <span className="w-10 text-center font-code">{fit ? "Fit" : `${Math.round(zoom * 100)}%`}</span>
          <button className="grid h-6 w-6 place-items-center rounded hover:bg-accent" title="Zoom in" aria-label="Zoom in" onClick={() => changeZoom(zoom * 1.25)}>
            <Plus className="h-3 w-3" />
          </button>
          <button className="grid h-6 w-6 place-items-center rounded hover:bg-accent" title="Fit to window" aria-label="Fit to window" onClick={() => setFit(true)}>
            <Maximize2 className="h-3 w-3" />
          </button>
          <button className="grid h-6 w-6 place-items-center rounded hover:bg-accent" title="Reset zoom" aria-label="Reset zoom" onClick={() => { setFit(true); setZoom(1); }}>
            <RotateCcw className="h-3 w-3" />
          </button>
          <a className="grid h-6 w-6 place-items-center rounded hover:bg-accent" title="Open original" aria-label="Open original" href={src} target="_blank" rel="noreferrer">
            <Download className="h-3 w-3" />
          </a>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto" style={{ backgroundImage: "linear-gradient(45deg, hsl(var(--muted) / .45) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--muted) / .45) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--muted) / .45) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--muted) / .45) 75%)", backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0", backgroundSize: "16px 16px" }}>
        {error ? (
          <div className="grid h-full place-items-center p-6 text-center text-xs text-red-400">Could not load this image.</div>
        ) : (
          <div className="flex min-h-full min-w-full items-center justify-center p-6">
            <img
              src={src}
              alt={name}
              className={cn("block rounded-sm shadow-lg", fit ? "max-h-full max-w-full object-contain" : "max-w-none")}
              style={fit ? undefined : { width: `${Math.max(1, zoom * 100)}%` }}
              onLoad={(event) => {
                const image = event.currentTarget;
                setDimensions(`${image.naturalWidth} × ${image.naturalHeight}`);
              }}
              onError={() => setError(true)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
