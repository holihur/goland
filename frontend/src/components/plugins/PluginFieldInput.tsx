import type { PluginField } from "@/lib/plugin-types";

export function PluginFieldInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PluginField;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown) => void;
}) {
  const id = `plugin-field-${field.key}`;
  const common =
    "w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60";
  return (
    <label className="block min-w-0 space-y-1" htmlFor={id}>
      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {field.label}
        {field.required ? <span className="text-red-400">*</span> : null}
      </span>
      {field.type === "textarea" ? (
        <textarea
          id={id}
          aria-label={field.label}
          className={`${common} min-h-[64px] resize-y font-code`}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.type === "boolean" ? (
        <span className="flex items-center gap-2">
          <input
            id={id}
            aria-label={field.label}
            type="checkbox"
            className="h-3.5 w-3.5 accent-sky-500"
            checked={value === true}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span className="text-[11px] text-muted-foreground">{field.help ?? "Enabled"}</span>
        </span>
      ) : field.type === "number" ? (
        <input
          id={id}
          aria-label={field.label}
          type="number"
          className={common}
          value={typeof value === "number" ? value : ""}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        />
      ) : field.type === "select" ? (
        <select
          id={id}
          aria-label={field.label}
          className={common}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">—</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          aria-label={field.label}
          type="text"
          className={common}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.help && field.type !== "boolean" ? (
        <span className="block break-words text-[10px] leading-4 text-muted-foreground">{field.help}</span>
      ) : null}
    </label>
  );
}
