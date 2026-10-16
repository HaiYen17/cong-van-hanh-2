"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Button, Input, LinkButton, Select } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

import { saveReactionSetAction, type ReactionActionState } from "./actions";

const initialState: ReactionActionState = {};

// Bám CONFIG_EVENT_EMOTION_LIBRARY bản Hành chính cũ.
const EMOTION_LIBRARY = [
  { key: "smile", label: "Mặt cười", symbol: "😊", tone: "emerald" },
  { key: "love", label: "Trái tim", symbol: "❤️", tone: "plum" },
  { key: "wow", label: "Bất ngờ", symbol: "🤩", tone: "amber" },
  { key: "cool", label: "Tuyệt", symbol: "😎", tone: "sky" },
  { key: "support", label: "Cố lên", symbol: "💪", tone: "teal" },
  { key: "sad", label: "Mặt buồn", symbol: "😢", tone: "coral" },
  { key: "care", label: "Quan tâm", symbol: "🤝", tone: "teal" },
  { key: "clap", label: "Vỗ tay", symbol: "👏", tone: "amber" },
] as const;

const TAG_TONES = ["emerald", "amber", "teal", "coral", "plum", "sky"];

const TONE_CLASS: Record<string, string> = {
  amber: "bg-amber-100 text-amber-700",
  coral: "bg-rose-100 text-rose-700",
  emerald: "bg-emerald-100 text-emerald-700",
  plum: "bg-fuchsia-100 text-fuchsia-700",
  sky: "bg-sky-100 text-sky-700",
  teal: "bg-teal-100 text-teal-700",
};
const toneClass = (tone?: string) => TONE_CLASS[tone || ""] || "bg-surface-muted text-foreground";

type ReactionOption = { label: string; symbol: string; tone: string; value: string };

export type EditingReactionSet = { id: string; mode: "emotion" | "tag"; name: string; options: ReactionOption[] };

function norm(v: string) {
  return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

export function ReactionSetForm({ editing }: { editing: EditingReactionSet | null }) {
  const [state, action, pending] = useActionState(saveReactionSetAction, initialState);
  const { toast } = useToast();
  const seen = useRef<ReactionActionState | null>(null);

  const [name, setName] = useState(editing?.name ?? "");
  const [mode, setMode] = useState<"emotion" | "tag">(editing?.mode ?? "emotion");
  const [options, setOptions] = useState<ReactionOption[]>(editing?.options ?? []);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.success) {
      toast({ message: state.success, title: "Bộ tương tác", tone: "success" });
    } else if (state.error) {
      toast({ message: state.error, title: "Lỗi", tone: "error" });
    }
  }, [state, toast]);

  const toggleEmotion = (key: string) => {
    const emo = EMOTION_LIBRARY.find((e) => e.key === key);
    if (!emo) return;
    setOptions((prev) =>
      prev.some((o) => norm(o.value || o.label) === norm(emo.key))
        ? prev.filter((o) => norm(o.value || o.label) !== norm(emo.key))
        : [...prev, { label: emo.label, symbol: emo.symbol, tone: emo.tone, value: emo.key }],
    );
  };

  const addTag = () => {
    const label = tagInput.trim();
    if (!label) return;
    setOptions((prev) =>
      prev.some((o) => norm(o.value || o.label) === norm(label))
        ? prev
        : [...prev, { label, symbol: "", tone: TAG_TONES[prev.length % TAG_TONES.length], value: label }],
    );
    setTagInput("");
  };

  const removeAt = (index: number) => setOptions((prev) => prev.filter((_, i) => i !== index));

  const resetForm = () => {
    setName("");
    setMode("emotion");
    setOptions([]);
    setTagInput("");
  };

  return (
    <form action={action} className="space-y-4">
      <input name="editId" type="hidden" value={editing?.id ?? ""} />
      <input name="options" type="hidden" value={JSON.stringify(options)} />

      {editing ? (
        <LinkButton href="/cau-hinh/thong-bao?tab=tuong-tac" size="sm" variant="ghost">
          ← Thoát chế độ sửa
        </LinkButton>
      ) : null}

      <label className="space-y-2 text-sm font-semibold text-foreground">
        <span>Tên bộ</span>
        <Input name="name" onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Cảm xúc hôm nay" required value={name} />
      </label>

      <label className="space-y-2 text-sm font-semibold text-foreground">
        <span>Dạng tương tác</span>
        <Select onChange={(e) => setMode(e.target.value as "emotion" | "tag")} value={mode}>
          <option value="emotion">Icon cảm xúc</option>
          <option value="tag">Thẻ tag</option>
        </Select>
      </label>

      {mode === "emotion" ? (
        <div className="space-y-2">
          <span className="text-sm font-semibold text-foreground">Chọn cảm xúc</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {EMOTION_LIBRARY.map((emo) => {
              const selected = options.some((o) => norm(o.value || o.label) === norm(emo.key));
              return (
                <button
                  className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition ${
                    selected ? "border-accent bg-accent/10 ring-2 ring-accent/20" : "border-border bg-surface hover:bg-surface-muted"
                  }`}
                  key={emo.key}
                  onClick={() => toggleEmotion(emo.key)}
                  type="button"
                >
                  <span className="text-2xl">{emo.symbol}</span>
                  <span className="text-xs font-semibold text-foreground">{emo.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <span className="text-sm font-semibold text-foreground">Thêm thẻ</span>
          <div className="flex gap-2">
            <Input
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addTag(); }
              }}
              placeholder="Ví dụ: XL hoặc Ca sáng"
              value={tagInput}
            />
            <Button onClick={addTag} type="button" variant="secondary">Thêm thẻ</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <span className="text-sm font-semibold text-foreground">Các lựa chọn đã chọn</span>
        {options.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface-muted px-3 py-2.5 text-sm text-muted">
            Chưa chọn lựa chọn nào.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {options.map((o, i) => (
              <button
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${toneClass(o.tone)}`}
                key={`${o.value}-${i}`}
                onClick={() => removeAt(i)}
                type="button"
              >
                {o.symbol ? <span>{o.symbol}</span> : null}
                <span>{o.label}</span>
                <span className="opacity-70">×</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} type="submit">
          {pending ? "Đang lưu..." : editing ? "Cập nhật bộ" : "Lưu bộ"}
        </Button>
        <Button onClick={resetForm} type="button" variant="ghost">Làm mới</Button>
      </div>
    </form>
  );
}
