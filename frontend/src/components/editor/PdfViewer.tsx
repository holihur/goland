import { Download, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";

export function PdfViewer({ workspaceId, path, name }: { workspaceId: string; path: string; name: string }) {
  const src = api.rawFileUrl(workspaceId, path);
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-panel/40 px-3 text-[10px] text-muted-foreground">
        <span className="min-w-0 truncate font-code">{name}</span>
        <span className="shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 text-[9px] text-red-400">PDF</span>
        <div className="ml-auto flex items-center gap-1">
          <a className="flex h-6 items-center gap-1 rounded px-1.5 hover:bg-accent" href={src} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3 w-3" /> Open
          </a>
          <a className="flex h-6 items-center gap-1 rounded px-1.5 hover:bg-accent" href={src} download={name}>
            <Download className="h-3 w-3" /> Download
          </a>
        </div>
      </div>
      <iframe src={src} title={name} className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>
  );
}
