import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DAPClient, Variable } from "@/lib/dap";

export function VariableRow({
  variable,
  client,
  depth,
}: {
  variable: Variable;
  client: DAPClient | null;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Variable[]>([]);
  const expandable = variable.variablesReference > 0;

  const toggle = async () => {
    if (!expandable || !client) return;
    if (!expanded && children.length === 0) {
      try {
        const result = await client.variables(variable.variablesReference);
        setChildren((result.variables as Variable[] | undefined) ?? []);
      } catch {
        return;
      }
    }
    setExpanded((value) => !value);
  };

  return (
    <div>
      <button
        className="flex w-full items-center gap-1 rounded px-0.5 py-0.5 text-left text-[9px] hover:bg-accent/60"
        style={{ paddingLeft: depth * 10 }}
        onClick={() => void toggle()}
      >
        {expandable ? (
          expanded ? (
            <ChevronDown className="h-2.5 w-2.5 shrink-0" />
          ) : (
            <ChevronRight className="h-2.5 w-2.5 shrink-0" />
          )
        ) : (
          <span className="w-2.5 shrink-0" />
        )}
        <span className="shrink-0 text-sky-300">{variable.name}</span>
        <span className="ml-1 truncate text-muted-foreground">= {variable.value}</span>
      </button>
      {expanded &&
        children.map((child, index) => (
          <VariableRow key={`${child.name}-${index}`} variable={child} client={client} depth={depth + 1} />
        ))}
    </div>
  );
}

