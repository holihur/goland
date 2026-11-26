import { useMemo, useState } from "react";
import { FileImage, FileText, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  IMAGE_EXTENSIONS,
  PDF_EXTENSIONS,
  normalizeAssociationTarget,
  viewerLabel,
  type FileAssociationOverrides,
  type ViewerKind,
} from "@/lib/fileAssociations";
import { cn } from "@/lib/utils";

const VIEWERS: Array<{ id: ViewerKind; label: string; hint: string }> = [
  { id: "code", label: "Code editor", hint: "Text and source files" },
  { id: "image", label: "Image viewer", hint: "Raster and SVG images" },
  { id: "pdf", label: "PDF viewer", hint: "Browser PDF surface" },
];

export function FileAssociationManager({
  overrides,
  onSet,
  onRemove,
  onReset,
}: {
  overrides: FileAssociationOverrides;
  onSet: (target: string, viewer: ViewerKind) => void;
  onRemove: (target: string) => void;
  onReset: () => void;
}) {
  const [target, setTarget] = useState("");
  const [viewer, setViewer] = useState<ViewerKind>("image");
  const [error, setError] = useState("");
  const entries = useMemo(() => Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)), [overrides]);

  const add = () => {
    const normalized = normalizeAssociationTarget(target);
    if (!normalized) {
      setError("Enter an extension like .foo or a filename like Dockerfile.");
      return;
    }
    onSet(normalized, viewer);
    setTarget("");
    setError("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <div className="text-xs font-semibold">Default viewers</div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            Unknown files fall back to the code editor. Custom rules below override the defaults.
          </div>
        </div>
        <button
          disabled={entries.length === 0}
          className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[10px] hover:bg-accent disabled:opacity-40"
          onClick={onReset}
        >
          <RotateCcw className="h-3 w-3" /> Reset rules
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {VIEWERS.map((item) => (
            <div key={item.id} className="rounded-lg border bg-panel/25 p-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                {item.id === "image" ? <FileImage className="h-4 w-4 text-sky-400" /> : item.id === "pdf" ? <FileText className="h-4 w-4 text-red-400" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                {item.label}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">{item.hint}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {item.id === "image" && IMAGE_EXTENSIONS.slice(0, 8).map((extension) => <span key={extension} className="rounded bg-muted px-1.5 py-0.5 font-code text-[9px]">{extension}</span>)}
                {item.id === "pdf" && PDF_EXTENSIONS.map((extension) => <span key={extension} className="rounded bg-muted px-1.5 py-0.5 font-code text-[9px]">{extension}</span>)}
                {item.id === "code" && <span className="rounded bg-muted px-1.5 py-0.5 font-code text-[9px]">all other files</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-lg border bg-panel/20">
          <div className="flex items-center justify-between border-b bg-muted/25 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">Custom associations</span>
            <span className="text-[9px] text-muted-foreground">{entries.length} rule{entries.length === 1 ? "" : "s"}</span>
          </div>
          {entries.length === 0 ? (
            <div className="px-3 py-5 text-center text-[10px] text-muted-foreground">No custom rules. Add an extension or filename below.</div>
          ) : (
            <div className="divide-y">
              {entries.map(([key, value]) => (
                <div key={key} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-code text-[11px]">{key}</span>
                  <span className="text-[9px] text-muted-foreground">→</span>
                  <select
                    aria-label={`Viewer for ${key}`}
                    className="h-7 rounded-md border bg-background px-1.5 text-[10px]"
                    value={value}
                    onChange={(event) => onSet(key, event.target.value as ViewerKind)}
                  >
                    {VIEWERS.map((item) => <option key={item.id} value={item.id}>{viewerLabel(item.id)}</option>)}
                  </select>
                  <button className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-red-400" title={`Remove ${key}`} onClick={() => onRemove(key)}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 rounded-lg border bg-panel/20 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em]">Add or override</div>
          <div className="flex flex-wrap gap-2">
            <input
              value={target}
              onChange={(event) => { setTarget(event.target.value); setError(""); }}
              onKeyDown={(event) => event.key === "Enter" && add()}
              placeholder=".foo or Dockerfile"
              className="h-8 min-w-[160px] flex-1 rounded-md border bg-background px-2 font-code text-[11px] outline-none focus:ring-1 focus:ring-ring"
            />
            <select value={viewer} onChange={(event) => setViewer(event.target.value as ViewerKind)} className="h-8 rounded-md border bg-background px-2 text-[10px]">
              {VIEWERS.map((item) => <option key={item.id} value={item.id}>{viewerLabel(item.id)}</option>)}
            </select>
            <button className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[10px] font-medium text-primary-foreground hover:opacity-90" onClick={add}>
              <Plus className="h-3 w-3" /> Add rule
            </button>
          </div>
          {error && <div className="mt-2 text-[10px] text-red-400">{error}</div>}
          <div className={cn("mt-2 text-[9px] text-muted-foreground")}>Rules apply immediately to newly opened files. Filenames like Dockerfile are supported.</div>
        </div>
      </div>
    </div>
  );
}
