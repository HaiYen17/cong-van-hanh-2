"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import {
  DOCUMENT_CONDITIONS,
  DOCUMENT_CYCLES,
  DOCUMENT_DECLARATIONS,
  renderPreview,
  TOKEN_BY_KEY,
  TOKEN_DEFS,
  type FormatToken,
} from "@/lib/document-numbering";

import {
  deleteDocumentTypeAction,
  type DocTypeActionState,
  resyncDocumentRegistryAction,
  saveDocumentTypeAction,
} from "./actions";

type DocumentTypeRow = {
  companyStartIndexes: Array<{
    companyId: string;
    companyLabel: string;
    lastIssuedSerial: number;
    startIndex: number;
  }>;
  condition: string;
  cycle: string;
  cycleLimit: number | null;
  declarationTypes: string[];
  formatTokens: FormatToken[];
  id: string;
  issuedSerials: Record<string, number>;
  name: string;
  registryCount: number;
  startIndex: number;
  status: string;
  takesNumber: boolean;
};

type CompanyOption = {
  id: string;
  label: string;
  shortName: string;
};

type CompanyStartDraft = {
  companyId: string;
  startIndex: number;
};

type TokenEditor = {
  index: number;
  mode: "edit" | "insert";
  type: string;
  value: string;
};

const initialState: DocTypeActionState = {};
const allDeclarationKeys = DOCUMENT_DECLARATIONS.map(({ key }) => key);

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function declarationLabel(keys: string[]) {
  return DOCUMENT_DECLARATIONS.filter(({ key }) => keys.includes(key))
    .map(({ label }) => label)
    .join(", ");
}

function tokenLabel(token: FormatToken) {
  const definition = TOKEN_BY_KEY.get(token.type);
  if (!definition) return token.type;
  if (definition.kind === "fixed") return `Cụm từ: ${token.value || ""}`;
  if (definition.kind === "serial") return `STT: ${token.value || "#"}`;
  return definition.label;
}

export function DocumentTypeConsole({
  canManage,
  companies,
  documentTypes,
}: {
  canManage: boolean;
  companies: CompanyOption[];
  documentTypes: DocumentTypeRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [saveState, saveAction, savePending] = useActionState(
    saveDocumentTypeAction,
    initialState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteDocumentTypeAction,
    initialState,
  );
  const [resyncState, resyncAction, resyncPending] = useActionState(
    resyncDocumentRegistryAction,
    initialState,
  );
  const seenSave = useRef<DocTypeActionState | null>(null);
  const seenDelete = useRef<DocTypeActionState | null>(null);
  const seenResync = useRef<DocTypeActionState | null>(null);

  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState("");
  const [name, setName] = useState("");
  const [takesNumber, setTakesNumber] = useState(true);
  const [condition, setCondition] = useState("");
  const [cycle, setCycle] = useState("");
  const [startIndex, setStartIndex] = useState("1");
  const [companyStarts, setCompanyStarts] = useState<CompanyStartDraft[]>([]);
  const [newCompanyId, setNewCompanyId] = useState("");
  const [cycleLimit, setCycleLimit] = useState("");
  const [declarations, setDeclarations] =
    useState<string[]>(allDeclarationKeys);
  const [tokens, setTokens] = useState<FormatToken[]>([]);
  const [editor, setEditor] = useState<TokenEditor | null>(null);
  const [editorError, setEditorError] = useState("");
  const [deleteSourceId, setDeleteSourceId] = useState("");
  const [replacementId, setReplacementId] = useState("");

  const resetForm = () => {
    setEditId("");
    setName("");
    setTakesNumber(true);
    setCondition("");
    setCycle("");
    setStartIndex("1");
    setCompanyStarts([]);
    setNewCompanyId("");
    setCycleLimit("");
    setDeclarations(allDeclarationKeys);
    setTokens([]);
  };

  useEffect(() => {
    if (saveState === seenSave.current) return;
    seenSave.current = saveState;
    if (saveState.success) {
      toast({
        message: saveState.success,
        title: "Cấu hình loại văn bản",
        tone: "success",
      });
      window.setTimeout(() => {
        resetForm();
        router.refresh();
      }, 0);
    } else if (saveState.error) {
      toast({ message: saveState.error, title: "Chưa lưu được", tone: "error" });
    }
  }, [router, saveState, toast]);

  useEffect(() => {
    if (deleteState === seenDelete.current) return;
    seenDelete.current = deleteState;
    if (deleteState.success) {
      toast({
        message: deleteState.success,
        title: "Đã chuyển dữ liệu và xóa",
        tone: "success",
      });
      window.setTimeout(() => {
        setDeleteSourceId("");
        setReplacementId("");
        resetForm();
        router.refresh();
      }, 0);
    } else if (deleteState.error) {
      toast({
        message: deleteState.error,
        title: "Chưa xóa được",
        tone: "error",
      });
    }
  }, [deleteState, router, toast]);

  useEffect(() => {
    if (resyncState === seenResync.current) return;
    seenResync.current = resyncState;
    if (resyncState.success) {
      toast({
        message: resyncState.success,
        title: "Đã quét lại loại văn bản",
        tone: "success",
      });
      router.refresh();
    } else if (resyncState.error) {
      toast({
        message: resyncState.error,
        title: "Quét lại chưa xong",
        tone: "error",
      });
    }
  }, [resyncState, router, toast]);

  const visibleTypes = useMemo(() => {
    const query = normalized(search);
    if (!query) return documentTypes;
    return documentTypes.filter((item) =>
      normalized(
        [
          item.name,
          item.condition,
          item.cycle,
          declarationLabel(item.declarationTypes),
          item.companyStartIndexes
            .map((rule) => `${rule.companyLabel} ${rule.startIndex}`)
            .join(" "),
          renderPreview(item.formatTokens, item.startIndex),
        ].join(" "),
      ).includes(query),
    );
  }, [documentTypes, search]);

  const deleteSource =
    documentTypes.find(({ id }) => id === deleteSourceId) ?? null;
  const replacement =
    documentTypes.find(({ id }) => id === replacementId) ?? null;

  const hydrate = (item: DocumentTypeRow) => {
    setEditId(item.id);
    setName(item.name);
    setTakesNumber(item.takesNumber);
    setCondition(item.condition);
    setCycle(item.cycle);
    setStartIndex(String(item.startIndex || 1));
    setCompanyStarts(
      item.companyStartIndexes.map((rule) => ({
        companyId: rule.companyId,
        startIndex: rule.startIndex,
      })),
    );
    setNewCompanyId("");
    setCycleLimit(item.cycleLimit ? String(item.cycleLimit) : "");
    setDeclarations(
      item.declarationTypes.length
        ? item.declarationTypes
        : allDeclarationKeys,
    );
    setTokens(item.formatTokens);
    window.scrollTo({ behavior: "smooth", top: 0 });
  };

  const activeDocumentType = documentTypes.find((item) => item.id === editId);
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const availableCompanies = companies.filter(
    (company) =>
      !companyStarts.some((rule) => rule.companyId === company.id),
  );

  const addCompanyStart = () => {
    if (!newCompanyId) return;
    const latest = activeDocumentType?.issuedSerials[newCompanyId] || 0;
    const fallback = Number.parseInt(startIndex, 10) || 1;
    setCompanyStarts((current) => [
      ...current,
      {
        companyId: newCompanyId,
        startIndex: Math.max(fallback, latest ? latest + 1 : fallback),
      },
    ]);
    setNewCompanyId("");
  };

  const updateCompanyStart = (companyId: string, value: string) => {
    const parsed = Number.parseInt(value, 10);
    setCompanyStarts((current) =>
      current.map((rule) =>
        rule.companyId === companyId
          ? {
              ...rule,
              startIndex: Number.isFinite(parsed) ? Math.max(1, parsed) : 1,
            }
          : rule,
      ),
    );
  };

  const toggleDeclaration = (key: string) => {
    setDeclarations((current) => {
      if (current.includes(key)) {
        return current.length === 1
          ? current
          : current.filter((item) => item !== key);
      }
      return [...current, key];
    });
  };

  const addToken = (type: string, index = tokens.length) => {
    const definition = TOKEN_BY_KEY.get(type);
    if (!definition) return;
    if (definition.kind === "serial" || definition.kind === "fixed") {
      setEditor({
        index,
        mode: "insert",
        type,
        value: definition.kind === "serial" ? "###" : "",
      });
      setEditorError("");
      return;
    }
    setTokens((current) => {
      const next = current.slice();
      next.splice(index, 0, { type });
      return next;
    });
  };

  const editToken = (index: number) => {
    const token = tokens[index];
    const definition = TOKEN_BY_KEY.get(token.type);
    if (
      !definition ||
      (definition.kind !== "serial" && definition.kind !== "fixed")
    ) {
      return;
    }
    setEditor({
      index,
      mode: "edit",
      type: token.type,
      value: token.value || (definition.kind === "serial" ? "#" : ""),
    });
    setEditorError("");
  };

  const saveTokenEditor = () => {
    if (!editor) return;
    const definition = TOKEN_BY_KEY.get(editor.type);
    const value = editor.value.trim();
    if (definition?.kind === "serial" && !/^#+$/.test(value)) {
      setEditorError(
        "Quy cách STT chỉ được nhập bằng dấu #, ví dụ ##, ### hoặc ####.",
      );
      return;
    }
    if (definition?.kind === "fixed" && !value) {
      setEditorError("Vui lòng nhập cụm từ cố định.");
      return;
    }
    const nextToken = {
      type: editor.type,
      value: value.replaceAll(";", " "),
    };
    setTokens((current) => {
      const next = current.slice();
      if (editor.mode === "edit") next.splice(editor.index, 1, nextToken);
      else next.splice(editor.index, 0, nextToken);
      return next;
    });
    setEditor(null);
    setEditorError("");
  };

  const moveToken = (from: number, to: number) => {
    setTokens((current) => {
      if (from < 0 || from >= current.length) return current;
      const next = current.slice();
      const [moved] = next.splice(from, 1);
      const target = to > from ? to - 1 : to;
      next.splice(Math.max(0, Math.min(target, next.length)), 0, moved);
      return next;
    });
  };

  const startNumber = Number.parseInt(startIndex, 10);
  const preview = renderPreview(
    tokens,
    Number.isFinite(startNumber) ? startNumber : 1,
  );
  const isPending = savePending || deletePending || resyncPending;

  return (
    <>
      <WriteLoadingOverlay
        message={
          deletePending
            ? "Đang chuyển dữ liệu và xóa loại văn bản..."
            : resyncPending
              ? "Đang quét lại hồ sơ theo cấu hình loại văn bản..."
              : "Đang lưu cấu hình loại văn bản..."
        }
        show={isPending}
      />

      <section className="document-console">
        <header className="document-console-header">
          <div className="document-title-wrap">
            <span className="document-section-tag">Cấu hình</span>
            <h1>Cấu hình loại văn bản</h1>
            <p>
              Khai báo loại hồ sơ, điều kiện lưu và quy cách cấp số dùng chung
              cho toàn bộ cổng vận hành.
            </p>
          </div>
          <Link
            aria-label="Đóng cấu hình loại văn bản"
            className="document-close-button"
            href="/cau-hinh"
          >
            ×
          </Link>
        </header>

        <div
          className={`document-layout${canManage ? "" : " is-readonly"}`}
        >
          {canManage ? (
            <section className="document-panel document-form-panel">
              <div className="document-panel-head">
                <div>
                  <h2>
                    {editId ? `Sửa loại: ${name}` : "Cấu hình loại văn bản"}
                  </h2>
                  <p>
                    Tạo tên văn bản, loại khai báo và quy tắc đánh số tương ứng.
                  </p>
                </div>
              </div>

              <form action={saveAction} className="document-form">
                <input name="editId" type="hidden" value={editId} />
                <input
                  name="declarationTypes"
                  type="hidden"
                  value={JSON.stringify(declarations)}
                />
                <input
                  name="formatTokens"
                  type="hidden"
                  value={JSON.stringify(tokens)}
                />
                <input
                  name="companyStartIndexes"
                  type="hidden"
                  value={JSON.stringify(companyStarts)}
                />

                <div className="document-form-grid">
                  <label className="document-field is-wide">
                    <span>Văn bản</span>
                    <input
                      autoComplete="off"
                      name="name"
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Nhập tên loại văn bản"
                      required
                      value={name}
                    />
                  </label>

                  <div className="document-switch-row is-wide">
                    <div>
                      <strong>Có lấy số</strong>
                      <p>
                        Tắt nếu loại hồ sơ chỉ cần lưu trữ và không cấp số văn
                        bản.
                      </p>
                    </div>
                    <label className="document-switch">
                      <input
                        checked={takesNumber}
                        name="takesNumber"
                        onChange={(event) =>
                          setTakesNumber(event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span />
                    </label>
                  </div>

                  {takesNumber ? (
                    <label className="document-field">
                      <span>Điều kiện</span>
                      <select
                        name="condition"
                        onChange={(event) => setCondition(event.target.value)}
                        value={condition}
                      >
                        <option value="">Chọn điều kiện</option>
                        {DOCUMENT_CONDITIONS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <div className="document-field is-wide">
                    <span>Loại khai báo</span>
                    <div className="document-declaration-list">
                      {DOCUMENT_DECLARATIONS.map((item) => {
                        const selected = declarations.includes(item.key);
                        return (
                          <button
                            aria-pressed={selected}
                            className={selected ? "is-selected" : ""}
                            key={item.key}
                            onClick={() => toggleDeclaration(item.key)}
                            type="button"
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                    <small>
                      Phải chọn ít nhất một loại khai báo cho form lưu trữ.
                    </small>
                  </div>

                  {takesNumber ? (
                    <>
                      <label className="document-field">
                        <span>Vòng lặp</span>
                        <select
                          name="cycle"
                          onChange={(event) => setCycle(event.target.value)}
                          value={cycle}
                        >
                          <option value="">Chọn vòng lặp</option>
                          {DOCUMENT_CYCLES.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="document-field">
                        <span>STT mặc định</span>
                        <input
                          min={1}
                          name="startIndex"
                          onChange={(event) =>
                            setStartIndex(event.target.value)
                          }
                          type="number"
                          value={startIndex}
                        />
                        <small>
                          Áp dụng cho pháp nhân chưa có quy tắc riêng.
                        </small>
                      </label>
                      {cycle === "Theo giới hạn" ? (
                        <label className="document-field">
                          <span>Giới hạn</span>
                          <input
                            min={1}
                            name="cycleLimit"
                            onChange={(event) =>
                              setCycleLimit(event.target.value)
                            }
                            type="number"
                            value={cycleLimit}
                          />
                        </label>
                      ) : null}
                    </>
                  ) : null}
                </div>

                {takesNumber ? (
                  <section className="document-company-numbering">
                    <div className="document-company-numbering-head">
                      <div>
                        <span className="document-detail-label">
                          Điểm bắt đầu theo pháp nhân
                        </span>
                        <p>
                          Chỉ thêm pháp nhân cần số riêng. Hệ thống luôn tiếp
                          tục sau số đã cấp gần nhất của đúng pháp nhân và chu kỳ.
                        </p>
                      </div>
                      <span className="document-company-count">
                        {companyStarts.length} quy tắc riêng
                      </span>
                    </div>

                    {companyStarts.length ? (
                      <div className="document-company-rule-list">
                        {companyStarts.map((rule) => {
                          const company = companyById.get(rule.companyId);
                          const latest =
                            activeDocumentType?.issuedSerials[rule.companyId] ||
                            0;
                          return (
                            <article
                              className="document-company-rule"
                              key={rule.companyId}
                            >
                              <div className="document-company-identity">
                                <strong>
                                  {company?.shortName || company?.label || "Pháp nhân"}
                                </strong>
                                <span>
                                  {latest
                                    ? `Số gần nhất trong chu kỳ: ${latest}`
                                    : "Chưa có số trong chu kỳ hiện tại"}
                                </span>
                              </div>
                              <label>
                                <span>Bắt đầu / tiếp theo</span>
                                <input
                                  min={1}
                                  onChange={(event) =>
                                    updateCompanyStart(
                                      rule.companyId,
                                      event.target.value,
                                    )
                                  }
                                  type="number"
                                  value={rule.startIndex}
                                />
                              </label>
                              <button
                                aria-label={`Bỏ quy tắc ${company?.label || "pháp nhân"}`}
                                onClick={() =>
                                  setCompanyStarts((current) =>
                                    current.filter(
                                      (item) =>
                                        item.companyId !== rule.companyId,
                                    ),
                                  )
                                }
                                title="Bỏ quy tắc riêng"
                                type="button"
                              >
                                ×
                              </button>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="document-company-empty">
                        Chưa có ngoại lệ. Tất cả pháp nhân đang dùng STT mặc định.
                      </div>
                    )}

                    {availableCompanies.length ? (
                      <div className="document-company-add">
                        <select
                          aria-label="Chọn pháp nhân cần số riêng"
                          onChange={(event) => setNewCompanyId(event.target.value)}
                          value={newCompanyId}
                        >
                          <option value="">Chọn pháp nhân cần số riêng</option>
                          {availableCompanies.map((company) => (
                            <option key={company.id} value={company.id}>
                              {company.shortName} · {company.label}
                            </option>
                          ))}
                        </select>
                        <button
                          disabled={!newCompanyId}
                          onClick={addCompanyStart}
                          type="button"
                        >
                          + Thêm pháp nhân
                        </button>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {takesNumber ? (
                  <div className="document-numbering-field">
                    <strong>Quy cách đánh số</strong>
                    <div className="document-format-builder">
                      <div className="document-format-section">
                        <span className="document-detail-label">
                          Thành phần
                        </span>
                        <div className="document-token-palette">
                          {TOKEN_DEFS.map((token) => (
                            <button
                              draggable
                              key={token.key}
                              onClick={() => addToken(token.key)}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "copy";
                                event.dataTransfer.setData(
                                  "application/x-document-token",
                                  token.key,
                                );
                              }}
                              type="button"
                            >
                              {token.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="document-format-section">
                        <span className="document-detail-label">
                          Quy cách hiện tại
                        </span>
                        <div
                          className="document-format-dropzone"
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const type = event.dataTransfer.getData(
                              "application/x-document-token",
                            );
                            if (type) addToken(type, tokens.length);
                          }}
                        >
                          {tokens.length ? (
                            <>
                              {tokens.map((token, index) => {
                                const configurable =
                                  TOKEN_BY_KEY.get(token.type)?.requiresConfig;
                                return (
                                  <div
                                    className="document-token-row"
                                    key={`${token.type}-${index}`}
                                  >
                                    <span
                                      className="document-drop-slot"
                                      onDragOver={(event) =>
                                        event.preventDefault()
                                      }
                                      onDrop={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        const paletteType =
                                          event.dataTransfer.getData(
                                            "application/x-document-token",
                                          );
                                        const draftIndex =
                                          event.dataTransfer.getData(
                                            "application/x-document-index",
                                          );
                                        if (paletteType) {
                                          addToken(paletteType, index);
                                        } else if (draftIndex) {
                                          moveToken(
                                            Number(draftIndex),
                                            index,
                                          );
                                        }
                                      }}
                                    />
                                    <button
                                      className={`document-format-chip${configurable ? " is-editable" : ""}`}
                                      draggable
                                      onClick={() => editToken(index)}
                                      onDragStart={(event) => {
                                        event.dataTransfer.effectAllowed =
                                          "move";
                                        event.dataTransfer.setData(
                                          "application/x-document-index",
                                          String(index),
                                        );
                                      }}
                                      type="button"
                                    >
                                      <span>{tokenLabel(token)}</span>
                                      <i
                                        aria-label="Xóa thành phần"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setTokens((current) =>
                                            current.filter(
                                              (_, tokenIndex) =>
                                                tokenIndex !== index,
                                            ),
                                          );
                                        }}
                                      >
                                        ×
                                      </i>
                                    </button>
                                  </div>
                                );
                              })}
                              <span
                                className="document-drop-slot is-end"
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  const paletteType =
                                    event.dataTransfer.getData(
                                      "application/x-document-token",
                                    );
                                  const draftIndex =
                                    event.dataTransfer.getData(
                                      "application/x-document-index",
                                    );
                                  if (paletteType) {
                                    addToken(paletteType, tokens.length);
                                  } else if (draftIndex) {
                                    moveToken(
                                      Number(draftIndex),
                                      tokens.length,
                                    );
                                  }
                                }}
                              />
                              <div className="document-format-preview">
                                <span>Xem trước</span>
                                <strong>{preview || "—"}</strong>
                              </div>
                            </>
                          ) : (
                            <div className="document-drop-empty">
                              Kéo thả hoặc bấm token để tạo quy cách đánh số.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="document-no-number">
                    Văn bản này không lấy số. Chỉ cần lưu tên văn bản và loại
                    khai báo.
                  </div>
                )}

                <div className="document-form-actions">
                  <button
                    className="document-button document-button--secondary"
                    onClick={resetForm}
                    type="button"
                  >
                    Làm mới
                  </button>
                  <button
                    className="document-button document-button--primary"
                    disabled={savePending}
                    type="submit"
                  >
                    {savePending
                      ? "Đang lưu..."
                      : editId
                        ? "Cập nhật cấu hình"
                        : "Lưu cấu hình"}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          <section className="document-panel document-list-panel">
            <div className="document-panel-head">
              <div>
                <h2>Danh sách loại văn bản</h2>
                <p>{documentTypes.length} loại đang có trong PostgreSQL.</p>
              </div>
              {canManage ? (
                <form action={resyncAction}>
                  <button
                    aria-label="Quét lại hồ sơ theo cấu hình loại văn bản"
                    className="document-resync-button"
                    disabled={resyncPending}
                    title="Quét lại hồ sơ theo cấu hình loại văn bản"
                    type="submit"
                  >
                    ↻
                  </button>
                </form>
              ) : null}
            </div>

            <div className="document-search">
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Gõ để tìm loại văn bản đã cấu hình"
                type="search"
                value={search}
              />
            </div>

            <div className="document-list">
              {visibleTypes.length ? (
                visibleTypes.map((item) => (
                  <article className="document-card" key={item.id}>
                    <div className="document-card-head">
                      <div>
                        <h3>{item.name}</h3>
                        {item.registryCount ? (
                          <span>{item.registryCount} hồ sơ đang liên kết</span>
                        ) : null}
                      </div>
                      {canManage ? (
                        <div className="document-card-actions">
                          <button
                            className="document-button document-button--secondary is-small"
                            onClick={() => hydrate(item)}
                            type="button"
                          >
                            Sửa
                          </button>
                          <button
                            aria-label="Xóa loại văn bản"
                            className="document-delete-button"
                            onClick={() => {
                              setDeleteSourceId(item.id);
                              setReplacementId("");
                            }}
                            title="Xóa loại văn bản"
                            type="button"
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                            >
                              <path d="M4 7h16" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                              <path d="M6 7l1 14h10l1-14" />
                              <path d="M9 7V4h6v3" />
                            </svg>
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <dl className="document-detail-list">
                      <div>
                        <dt>Lấy số</dt>
                        <dd>{item.takesNumber ? "Có" : "Không"}</dd>
                      </div>
                      <div>
                        <dt>Loại khai báo</dt>
                        <dd>
                          {declarationLabel(item.declarationTypes) || "—"}
                        </dd>
                      </div>
                      {item.takesNumber ? (
                        <>
                          <div>
                            <dt>Điều kiện</dt>
                            <dd>{item.condition || "—"}</dd>
                          </div>
                          <div>
                            <dt>Quy cách đánh số</dt>
                            <dd className="is-number">
                              {renderPreview(
                                item.formatTokens,
                                item.startIndex,
                              ) || "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>STT mặc định</dt>
                            <dd>{item.startIndex}</dd>
                          </div>
                          <div>
                            <dt>Theo pháp nhân</dt>
                            <dd>
                              {item.companyStartIndexes.length ? (
                                <span className="document-company-summary">
                                  {item.companyStartIndexes.map((rule) => (
                                    <span key={rule.companyId}>
                                      {rule.companyLabel}: {rule.startIndex}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                "Dùng mặc định"
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Vòng lặp</dt>
                            <dd>
                              {item.cycle === "Theo giới hạn" &&
                              item.cycleLimit
                                ? `${item.cycle} (${item.cycleLimit})`
                                : item.cycle || "—"}
                            </dd>
                          </div>
                        </>
                      ) : null}
                    </dl>
                  </article>
                ))
              ) : (
                <div className="document-empty">
                  <strong>Không tìm thấy loại văn bản</strong>
                  <span>Thử đổi từ khóa để xem lại danh sách đã cấu hình.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>

      {editor ? (
        <div className="document-modal">
          <button
            aria-label="Đóng"
            className="document-modal-backdrop"
            onClick={() => setEditor(null)}
            type="button"
          />
          <section
            aria-modal="true"
            className="document-modal-card"
            role="dialog"
          >
            <div className="document-modal-head">
              <div>
                <h2>
                  {editor.type === "SERIAL"
                    ? "Cấu hình STT"
                    : "Cấu hình cụm từ cố định"}
                </h2>
                <p>
                  {editor.type === "SERIAL"
                    ? "Nhập bằng dấu #, ví dụ ##, ### hoặc ####."
                    : "Nhập cụm từ cố định để chèn vào quy cách đánh số."}
                </p>
              </div>
              <button onClick={() => setEditor(null)} type="button">
                ×
              </button>
            </div>
            <label className="document-field">
              <span>
                {editor.type === "SERIAL"
                  ? "Quy cách STT"
                  : "Cụm từ cố định"}
              </span>
              <input
                autoFocus
                onChange={(event) =>
                  setEditor((current) =>
                    current
                      ? { ...current, value: event.target.value }
                      : current,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveTokenEditor();
                  }
                }}
                placeholder={
                  editor.type === "SERIAL"
                    ? "Ví dụ: ###"
                    : "Nhập cụm từ cố định"
                }
                value={editor.value}
              />
            </label>
            {editorError ? (
              <p className="document-modal-error">{editorError}</p>
            ) : null}
            <div className="document-form-actions">
              <button
                className="document-button document-button--secondary"
                onClick={() => setEditor(null)}
                type="button"
              >
                Hủy
              </button>
              <button
                className="document-button document-button--primary"
                onClick={saveTokenEditor}
                type="button"
              >
                Lưu thành phần
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteSource ? (
        <div className="document-modal">
          <button
            aria-label="Đóng"
            className="document-modal-backdrop"
            onClick={() => setDeleteSourceId("")}
            type="button"
          />
          <section
            aria-modal="true"
            className="document-modal-card"
            role="dialog"
          >
            <div className="document-modal-head">
              <div>
                <h2>Xóa loại văn bản &quot;{deleteSource.name}&quot;</h2>
                <p>
                  Toàn bộ hồ sơ đang dùng loại này sẽ được chuyển sang loại
                  thay thế trước khi xóa cấu hình.
                </p>
              </div>
              <button onClick={() => setDeleteSourceId("")} type="button">
                ×
              </button>
            </div>
            <form action={deleteAction} className="document-delete-form">
              <input name="sourceId" type="hidden" value={deleteSource.id} />
              <label className="document-field">
                <span>Loại hồ sơ thay thế</span>
                <select
                  name="replacementId"
                  onChange={(event) => setReplacementId(event.target.value)}
                  required
                  value={replacementId}
                >
                  <option value="">Chọn loại văn bản thay thế</option>
                  {documentTypes
                    .filter(({ id }) => id !== deleteSource.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              <p className="document-delete-preview">
                {replacement
                  ? `Sẽ chuyển "${deleteSource.name}" sang "${replacement.name}". Lấy số: ${replacement.takesNumber ? "Có" : "Không"}${replacement.condition ? ` • Điều kiện: ${replacement.condition}` : ""}.`
                  : "Chọn loại hồ sơ thay thế để chuyển dữ liệu cũ."}
              </p>
              <div className="document-form-actions">
                <button
                  className="document-button document-button--secondary"
                  onClick={() => setDeleteSourceId("")}
                  type="button"
                >
                  Hủy
                </button>
                <button
                  className="document-button document-button--danger"
                  disabled={!replacementId || deletePending}
                  type="submit"
                >
                  {deletePending ? "Đang xóa..." : "Xóa và chuyển dữ liệu"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
