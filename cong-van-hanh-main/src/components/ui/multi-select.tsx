"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type MultiOption = { label: string; sub?: string; value: string };

function norm(v: string) {
  return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// Multi-select có ô tìm kiếm + chip đã chọn. Gửi nhiều <input hidden name=...> để form đọc bằng getAll.
export function MultiSelect({
  defaultValues = [],
  name,
  onValuesChange,
  options,
  placeholder = "Gõ để tìm rồi chọn...",
  values,
}: {
  defaultValues?: string[];
  name: string;
  onValuesChange?: (values: string[]) => void;
  options: MultiOption[];
  placeholder?: string;
  values?: string[];
}) {
  const [internalSelected, setInternalSelected] =
    useState<string[]>(defaultValues);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = values ?? internalSelected;

  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const nq = norm(query.trim());
  const filtered = useMemo(
    () =>
      options
        .filter((o) => !selected.includes(o.value))
        .filter(
          (o) =>
            !nq ||
            norm(o.label).includes(nq) ||
            norm(o.sub || "").includes(nq) ||
            norm(o.value).includes(nq),
        )
        .slice(0, 50),
    [options, selected, nq],
  );

  function updateSelected(next: string[]) {
    const unique = [...new Set(next)];
    if (values === undefined) {
      setInternalSelected(unique);
    }
    onValuesChange?.(unique);
  }

  useEffect(() => {
    if (!open) return;
    const closeWhenClickingOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenClickingOutside, true);
    return () => {
      document.removeEventListener("pointerdown", closeWhenClickingOutside, true);
    };
  }, [open]);

  return (
    <div className="space-y-2" ref={rootRef}>
      {selected.map((v) => (
        <input key={v} name={name} type="hidden" value={v} />
      ))}
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((v) => (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
              key={v}
            >
              {byValue.get(v)?.label ?? v}
              <button
                aria-label="Bỏ chọn"
                className="text-primary/70 hover:text-danger"
                onClick={() =>
                  updateSelected(selected.filter((item) => item !== v))
                }
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <input
          autoComplete="off"
          className="h-11 w-full rounded-lg border border-border bg-surface px-3.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              event.currentTarget.blur();
            }
          }}
          placeholder={placeholder}
          value={query}
        />
        {open ? (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-border bg-surface p-1 shadow-[0_18px_44px_rgba(17,45,39,0.16)]">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted">Không còn lựa chọn.</div>
            ) : (
              filtered.map((o) => (
                <button
                  className="flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-surface-muted"
                  key={o.value}
                  onClick={() => {
                    updateSelected([...selected, o.value]);
                    setQuery("");
                  }}
                  onMouseDown={(ev) => ev.preventDefault()}
                  type="button"
                >
                  <span className="text-sm font-semibold text-foreground">{o.label}</span>
                  {o.sub ? <span className="text-xs text-muted">{o.sub}</span> : null}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
