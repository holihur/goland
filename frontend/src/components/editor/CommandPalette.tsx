import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { FileCode2, Loader2, Search } from "lucide-react";
import { api } from "@/lib/api";
import type { Entry } from "@/lib/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { PaletteAction } from "./paletteTypes";

export function CommandPalette({
  open,
  onOpenChange,
  workspaceId,
  onOpenFile,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onOpenFile: (path: string) => void;
  actions: PaletteAction[];
}) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setFiles([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !query.trim()) {
      setFiles([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      api
        .search(workspaceId, query.trim())
        .then((result) => setFiles(result.results))
        .catch(() => setFiles([]))
        .finally(() => setLoading(false));
    }, 170);
    return () => window.clearTimeout(timer);
  }, [query, open, workspaceId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command shouldFilter={false} className="bg-transparent">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search files or run a command…"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <kbd className="rounded border px-1 font-code text-[9px] text-muted-foreground">esc</kbd>
          </div>
          <Command.List className="max-h-[360px] overflow-auto p-1.5">
            <Command.Empty className="px-3 py-8 text-center text-xs text-muted-foreground">
              No results found.
            </Command.Empty>
            {query.trim() && files.length > 0 && (
              <Command.Group heading="Files" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground">
                {files.map((file) => (
                  <Command.Item
                    key={file.path}
                    value={`file:${file.path}`}
                    onSelect={() => {
                      onOpenFile(file.path);
                      onOpenChange(false);
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs aria-selected:bg-accent aria-selected:text-accent-foreground"
                  >
                    <FileCode2 className="h-3.5 w-3.5 text-sky-400" />
                    <span className="truncate">{file.path}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {!query.trim() && (
              <Command.Group heading="Workspace" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground">
                {actions.map((action) => (
                  <Command.Item
                    key={action.id}
                    value={action.id}
                    onSelect={() => {
                      action.run();
                      onOpenChange(false);
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs aria-selected:bg-accent aria-selected:text-accent-foreground"
                  >
                    {action.icon}
                    <span>{action.label}</span>
                    {action.hint && <span className="ml-auto font-code text-[10px] text-muted-foreground">{action.hint}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
