"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  LayoutGrid,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import { ModuleIcon } from "@/lib/module-icons";
import type {
  WorkbenchAdminSnapshot,
  WorkbenchSourceConfigView,
  WorkbenchWidgetConfigView,
} from "@/lib/workbench/types";

import {
  refreshWorkbenchIndexAdminAction,
  saveWorkbenchAdminConfigAction,
} from "./actions";
import styles from "./workbench-config.module.css";

const TONES = [
  { label: "Xanh đậm", value: "teal" },
  { label: "Cam nhạt", value: "amber" },
  { label: "Cam đỏ", value: "coral" },
  { label: "Xanh trời", value: "blue" },
  { label: "Tím", value: "violet" },
  { label: "Xám", value: "slate" },
] as const;

function cloneSnapshot(snapshot: WorkbenchAdminSnapshot): WorkbenchAdminSnapshot {
  return {
    ...snapshot,
    sources: snapshot.sources.map((item) => ({ ...item })),
    widgets: snapshot.widgets.map((item) => ({ ...item })),
  };
}

function dateTime(value: string) {
  if (!value) return "Chưa đồng bộ";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

function NumericField({
  label,
  max,
  min,
  onChange,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className={styles.numericField}>
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={1}
        type="number"
        value={value}
      />
    </label>
  );
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.toggleLine}>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span aria-hidden="true" className={styles.toggleTrack} />
      <strong>{label}</strong>
    </label>
  );
}

export function WorkbenchConfigWorkspace({
  canManage,
  initialSnapshot,
}: {
  canManage: boolean;
  initialSnapshot: WorkbenchAdminSnapshot;
}) {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState(() => cloneSnapshot(initialSnapshot));
  const [busyMessage, setBusyMessage] = useState("");
  const enabledWidgets = useMemo(
    () => snapshot.widgets.filter((widget) => widget.isEnabled).length,
    [snapshot.widgets],
  );

  function updateWidget(
    configKey: string,
    update: Partial<WorkbenchWidgetConfigView>,
  ) {
    setSnapshot((current) => ({
      ...current,
      widgets: current.widgets.map((widget) =>
        (widget.catalogKey || widget.key) === configKey
          ? { ...widget, ...update }
          : widget,
      ),
    }));
  }

  function updateSource(
    key: WorkbenchSourceConfigView["key"],
    isEnabled: boolean,
  ) {
    setSnapshot((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.key === key ? { ...source, isEnabled } : source,
      ),
    }));
  }

  async function save() {
    setBusyMessage("Đang lưu registry widget và bố cục gợi ý…");
    const result = await saveWorkbenchAdminConfigAction({
      sources: snapshot.sources.map((source) => ({
        isEnabled: source.isEnabled,
        key: source.key,
      })),
      widgets: snapshot.widgets,
    });
    setBusyMessage("");
    if (!result.ok) {
      toast({ message: result.message, title: "Không lưu được cấu hình", tone: "error" });
      return;
    }
    if (result.data) setSnapshot(cloneSnapshot(result.data));
    toast({ title: result.message, tone: "success" });
  }

  async function refreshIndex() {
    setBusyMessage("Đang đọc các module và cập nhật chỉ mục công việc…");
    const result = await refreshWorkbenchIndexAdminAction();
    setBusyMessage("");
    if (!result.ok) {
      toast({ message: result.message, title: "Không đồng bộ được chỉ mục", tone: "error" });
      return;
    }
    if (result.data) setSnapshot(cloneSnapshot(result.data));
    toast({ title: result.message, tone: "success" });
  }

  return (
    <>
      <WriteLoadingOverlay message={busyMessage} show={Boolean(busyMessage)} />
      <section className={styles.toolbar}>
        <div className={styles.stats}>
          <span><LayoutGrid size={17} /><strong>{enabledWidgets}</strong> widget đang bật</span>
          <span><Activity size={17} /><strong>{snapshot.indexedItems}</strong> mục đang mở</span>
          <span><DatabaseZap size={17} /><strong>{snapshot.indexedUsers}</strong> người đã lập chỉ mục</span>
          <span><Save size={17} /><strong>{snapshot.savedLayouts}</strong> bố cục cá nhân</span>
        </div>
        {canManage ? (
          <div className={styles.actions}>
            <Button onClick={() => void refreshIndex()} variant="secondary">
              <RefreshCw size={16} /> Đồng bộ tài khoản này
            </Button>
            <Button onClick={() => void save()}>
              <Save size={16} /> Lưu cấu hình
            </Button>
          </div>
        ) : null}
      </section>

      <div className={styles.layout}>
        <main className={styles.widgetPanel}>
          <div className={styles.sectionHeading}>
            <div>
              <span>Kho widget</span>
              <h2>Registry hiển thị</h2>
              <p>Bật, giới hạn kích thước và quy hoạch vị trí gợi ý trên lưới 16 × 10.</p>
            </div>
            {canManage ? (
              <Button
                onClick={() => setSnapshot(cloneSnapshot(initialSnapshot))}
                size="sm"
                variant="ghost"
              >
                <RotateCcw size={15} /> Hoàn tác chưa lưu
              </Button>
            ) : null}
          </div>

          <div className={styles.widgetList}>
            {snapshot.widgets.map((widget) => (
              <article
                className={`${styles.widgetCard} ${!widget.isEnabled ? styles.disabledCard : ""}`}
                key={widget.catalogKey || widget.key}
              >
                <header>
                  <span className={styles.widgetIcon}><ModuleIcon name={widget.icon} /></span>
                  <div>
                    <strong>{widget.label}</strong>
                    <small>{widget.description}</small>
                  </div>
                  <Toggle
                    checked={widget.isEnabled}
                    disabled={!canManage}
                    label={widget.isEnabled ? "Đang bật" : "Đang tắt"}
                    onChange={(isEnabled) => updateWidget(widget.catalogKey || widget.key, { isEnabled })}
                  />
                </header>

                <div className={styles.optionRow}>
                  <Toggle
                    checked={widget.defaultVisible}
                    disabled={!canManage || !widget.isEnabled}
                    label="Có trên bàn mặc định"
                    onChange={(defaultVisible) => updateWidget(widget.catalogKey || widget.key, { defaultVisible })}
                  />
                  <Toggle
                    checked={widget.allowMultiple}
                    disabled={!canManage || !widget.isEnabled || widget.key === "requests"}
                    label={widget.key === "requests" ? "Mỗi module một widget" : "Cho phép thêm nhiều"}
                    onChange={(allowMultiple) => updateWidget(widget.catalogKey || widget.key, { allowMultiple })}
                  />
                  <label className={styles.colorField}>
                    <span>Màu mặc định</span>
                    <select
                      disabled={!canManage || !widget.isEnabled}
                      onChange={(event) =>
                        updateWidget(widget.catalogKey || widget.key, {
                          defaultColor: event.target.value as WorkbenchWidgetConfigView["defaultColor"],
                        })
                      }
                      value={widget.defaultColor}
                    >
                      {TONES.map((tone) => <option key={tone.value} value={tone.value}>{tone.label}</option>)}
                    </select>
                  </label>
                </div>

                <div className={styles.dimensionGroups}>
                  <fieldset disabled={!canManage || !widget.isEnabled}>
                    <legend>Kích thước ngang</legend>
                    <NumericField label="Tối thiểu" max={16} min={1} onChange={(minWidth) => updateWidget(widget.catalogKey || widget.key, { minWidth })} value={widget.minWidth} />
                    <NumericField label="Mặc định" max={16} min={1} onChange={(defaultWidth) => updateWidget(widget.catalogKey || widget.key, { defaultWidth })} value={widget.defaultWidth} />
                    <NumericField label="Tối đa" max={16} min={1} onChange={(maxWidth) => updateWidget(widget.catalogKey || widget.key, { maxWidth })} value={widget.maxWidth} />
                  </fieldset>
                  <fieldset disabled={!canManage || !widget.isEnabled}>
                    <legend>Kích thước dọc</legend>
                    <NumericField label="Tối thiểu" max={10} min={1} onChange={(minHeight) => updateWidget(widget.catalogKey || widget.key, { minHeight })} value={widget.minHeight} />
                    <NumericField label="Mặc định" max={10} min={1} onChange={(defaultHeight) => updateWidget(widget.catalogKey || widget.key, { defaultHeight })} value={widget.defaultHeight} />
                    <NumericField label="Tối đa" max={10} min={1} onChange={(maxHeight) => updateWidget(widget.catalogKey || widget.key, { maxHeight })} value={widget.maxHeight} />
                  </fieldset>
                  <fieldset disabled={!canManage || !widget.isEnabled}>
                    <legend>Vị trí gợi ý</legend>
                    <NumericField label="Cột X" max={15} min={0} onChange={(defaultX) => updateWidget(widget.catalogKey || widget.key, { defaultX })} value={widget.defaultX} />
                    <NumericField label="Hàng Y" max={9} min={0} onChange={(defaultY) => updateWidget(widget.catalogKey || widget.key, { defaultY })} value={widget.defaultY} />
                    <NumericField label="Thứ tự" max={9999} min={0} onChange={(sortOrder) => updateWidget(widget.catalogKey || widget.key, { sortOrder })} value={widget.sortOrder} />
                  </fieldset>
                </div>
              </article>
            ))}
          </div>
        </main>

        <aside className={styles.sourcePanel}>
          <div className={styles.sectionHeading}>
            <div>
              <span>Kho sự kiện</span>
              <h2>Nguồn công việc</h2>
              <p>Dữ liệu được chuẩn hóa theo từng người dùng; bản ghi module gốc không bị thay đổi.</p>
            </div>
          </div>
          <div className={styles.sourceList}>
            {snapshot.sources.map((source) => (
              <article key={source.key}>
                <header>
                  <span className={source.lastStatus === "ERROR" ? styles.errorIcon : styles.okIcon}>
                    {source.lastStatus === "ERROR" ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                  </span>
                  <div><strong>{source.label}</strong><small>{source.description}</small></div>
                </header>
                <div className={styles.sourceMeta}>
                  <span>{source.itemCount} mục đang mở</span>
                  <span>{dateTime(source.lastSyncedAt)}</span>
                </div>
                {source.lastError ? <p className={styles.sourceError}>{source.lastError}</p> : null}
                <Toggle
                  checked={source.isEnabled}
                  disabled={!canManage}
                  label={source.isEnabled ? "Nhận sự kiện" : "Tạm ngưng nguồn"}
                  onChange={(isEnabled) => updateSource(source.key, isEnabled)}
                />
              </article>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
