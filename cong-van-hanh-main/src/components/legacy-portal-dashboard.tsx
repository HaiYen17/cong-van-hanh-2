"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  changePasswordAction,
  type AccountActionState,
} from "@/app/account-actions";
import { reactToEventAction } from "@/app/motivation-actions";
import {
  createNotifierPairCodeAction,
  type NotifierPairCode,
} from "@/app/notifier-actions";
import { NotifierMount } from "@/components/notifier-mount";
import { renderMotivationRichText } from "@/components/motivation-rich-text";
import { PortalPresenceDrawer } from "@/components/portal-presence-drawer";
import { useToast } from "@/components/ui/toast";
import { logoutAction } from "@/lib/auth/actions";
import type {
  LegacyFeatureGroup,
  LegacyModuleCard,
} from "@/lib/legacy-portal-catalog";
import { ModuleIcon } from "@/lib/module-icons";
import type {
  MotivationItem,
  MotivationOption,
  MotivationStage,
} from "@/lib/motivation";
import {
  formatMotivationCompactSchedule,
  formatMotivationSchedule,
} from "@/lib/motivation-policy";

const NOTIFIER_WINDOWS_URL =
  "https://drive.google.com/uc?export=download&id=1WkiOpZzjk0_JVnwCtx9kNzc6HhE_MzfY";
const NOTIFIER_MAC_URL =
  "https://drive.google.com/uc?export=download&id=1EVeoxFTSynV8UwYuuvjb2lRsCzjz-IrG";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "TV";
  return (
    parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`
      : parts[0].slice(0, 2)
  ).toUpperCase();
}

function availabilityLabel(
  availability: LegacyModuleCard["availability"],
) {
  return availability === "maintenance" ? "Đang bảo trì" : "Sắp ra mắt";
}

function FeatureCard({ item }: { item: LegacyModuleCard }) {
  const content = (
    <>
      <span
        className={`feature-card-badge${
          (item.badgeCount ?? 0) > 0 ? "" : " is-hidden"
        }`}
        data-feature-badge={item.key}
      >
        {(item.badgeCount ?? 0) > 0 ? item.badgeCount : ""}
      </span>
      <div className="feature-card-icon">
        <ModuleIcon name={item.icon} />
      </div>
      <div className="feature-card-name">{item.label}</div>
      {item.availability ? (
        <div
          aria-hidden="true"
          className="ui-availability-overlay"
          data-availability-status={item.availability}
        >
          <span className="ui-availability-overlay-label">
            {availabilityLabel(item.availability)}
          </span>
        </div>
      ) : null}
    </>
  );

  if (!item.href || item.availability) {
    return (
      <article
        aria-disabled="true"
        className="feature-card ui-availability-host is-unavailable"
        data-key={item.key}
        data-label={item.label}
        role="button"
        tabIndex={0}
        title={
          item.availability
            ? availabilityLabel(item.availability)
            : `Module ${item.label} chưa sẵn sàng để mở.`
        }
      >
        {content}
      </article>
    );
  }

  return (
    <Link
      className="feature-card"
      data-key={item.key}
      data-label={item.label}
      href={item.href}
      role="button"
    >
      {content}
    </Link>
  );
}

function FeatureGrid({ items }: { items: LegacyModuleCard[] }) {
  return (
    <div className="feature-grid" data-count={items.length}>
      {items.map((item) => (
        <FeatureCard item={item} key={item.key} />
      ))}
    </div>
  );
}

type FeatureBlock =
  | { group: LegacyFeatureGroup; type: "group" }
  | {
      groups: LegacyFeatureGroup[];
      key: string;
      title: string;
      tone: string;
      type: "collection";
    };

function buildBlocks(groups: LegacyFeatureGroup[]) {
  const blocks: FeatureBlock[] = [];
  const collectionMap = new Map<string, Extract<FeatureBlock, { type: "collection" }>>();

  for (const group of groups) {
    if (!group.collectionKey) {
      blocks.push({ group, type: "group" });
      continue;
    }
    let collection = collectionMap.get(group.collectionKey);
    if (!collection) {
      collection = {
        groups: [],
        key: group.collectionKey,
        title: group.collectionTitle ?? "",
        tone: group.collectionTone ?? group.tone,
        type: "collection",
      };
      collectionMap.set(group.collectionKey, collection);
      blocks.push(collection);
    }
    collection.groups.push(group);
  }
  return blocks;
}

function CollectionSubgroup({ group }: { group: LegacyFeatureGroup }) {
  return (
    <section
      className="feature-subgroup"
      data-group-key={group.key}
      data-item-count={group.items.length}
      data-tone={group.tone}
    >
      <h4 className="feature-subgroup-title">{group.title}</h4>
      <FeatureGrid items={group.items} />
    </section>
  );
}

function FeatureCollection({
  block,
}: {
  block: Extract<FeatureBlock, { type: "collection" }>;
}) {
  const useSpecialNtvLayout =
    block.key === "nguoi-thuan-viet" && block.groups.length === 5;
  const stackedKeys = new Set([
    "nguoi-thuan-viet-orders",
    "nguoi-thuan-viet-utilities",
  ]);
  const stacked = useSpecialNtvLayout
    ? block.groups.filter((group) => stackedKeys.has(group.key))
    : [];
  const remaining = useSpecialNtvLayout
    ? block.groups.filter((group) => !stackedKeys.has(group.key))
    : block.groups;

  return (
    <section
      className="feature-group feature-collection feature-glass-panel"
      data-collection-key={block.key}
      data-group-count={block.groups.length}
      data-tone={block.tone}
    >
      <h3 className="feature-group-title">{block.title}</h3>
      <div className="feature-collection-sections">
        {stacked.length > 0 ? (
          <div className="feature-subgroup-stack">
            {stacked.map((group) => (
              <CollectionSubgroup group={group} key={group.key} />
            ))}
          </div>
        ) : null}
        {remaining.map((group) => (
          <CollectionSubgroup group={group} key={group.key} />
        ))}
      </div>
    </section>
  );
}

function LegacyFeatureGroups({
  groups,
  query,
}: {
  groups: LegacyFeatureGroup[];
  query: string;
}) {
  const filtered = useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return groups;
    return groups.flatMap((group) => {
      const groupText = normalize(
        [
          group.title,
          group.key,
          group.collectionTitle,
          group.collectionKey,
        ].join(" "),
      );
      const groupMatches = terms.every((term) => groupText.includes(term));
      const items = groupMatches
        ? group.items
        : group.items.filter((item) => {
            const itemText = normalize(
              [item.label, item.key, item.icon, groupText].join(" "),
            );
            return terms.every((term) => itemText.includes(term));
          });
      return items.length > 0 ? [{ ...group, items }] : [];
    });
  }, [groups, query]);

  if (filtered.length === 0) {
    return (
      <section className="empty-state dashboard-search-empty">
        <h3 className="empty-state-title">Không tìm thấy module</h3>
        <p className="empty-state-text">
          Không có module nào khớp với &quot;{query.trim()}&quot;. Thử gõ tên
          ngắn hơn hoặc tên nhóm chức năng.
        </p>
      </section>
    );
  }

  return buildBlocks(filtered).map((block) =>
    block.type === "collection" ? (
      <FeatureCollection block={block} key={`collection-${block.key}`} />
    ) : (
      <section
        className="feature-group feature-glass-panel feature-group--standalone"
        data-item-count={block.group.items.length}
        data-tone={block.group.tone}
        key={block.group.key}
      >
        <h3 className="feature-group-title">{block.group.title}</h3>
        <FeatureGrid items={block.group.items} />
      </section>
    ),
  );
}

function ReactionRow({
  item,
  variant,
}: {
  item: MotivationItem;
  variant: "hero" | "popup";
}) {
  const [localReaction, setLocalReaction] = useState(item.myReaction);
  const [, startTransition] = useTransition();

  if (item.options.length === 0) return null;
  return (
    <div
      className={`dashboard-reaction-row dashboard-reaction-row--${variant}`}
    >
      {item.options.map((option: MotivationOption) => {
        const value = option.value || option.label;
        const selected = localReaction === value;
        return (
          <button
            aria-label={option.label || option.value}
            aria-pressed={selected}
            className={`dashboard-reaction-chip${
              option.tone ? ` is-${option.tone}` : ""
            }${selected ? " is-selected" : ""}`}
            key={value}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setLocalReaction(value);
              startTransition(() => {
                void reactToEventAction(item.eventId, value, option.label);
              });
            }}
            type="button"
          >
            {option.symbol ? (
              <span className="dashboard-reaction-symbol" aria-hidden="true">
                {option.symbol}
              </span>
            ) : null}
            {variant === "hero" && option.symbol ? null : (
              <span className="dashboard-reaction-label">{option.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function MotivationDetail({
  item,
  onClose,
}: {
  item: MotivationItem;
  onClose: () => void;
}) {
  const [viewImage, setViewImage] = useState<string | null>(null);
  const typeLabel =
    item.kind === "notice"
      ? "Thông báo"
      : item.kind === "event"
        ? "Sự kiện"
        : "Thông điệp";
  const images = Array.from(
    new Set(
      [...item.imageUrls, item.imageUrl]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const schedule = formatMotivationSchedule(item.startAt, item.endAt);

  return (
    <>
      <div
        aria-hidden="false"
        className="dashboard-motivation-popup"
        data-content-type={item.kind}
      >
        <button
          aria-label="Đóng chi tiết sự kiện"
          className="dashboard-motivation-popup-backdrop"
          onClick={onClose}
          type="button"
        />
        <div
          aria-label="Chi tiết sự kiện"
          aria-modal="true"
          className="dashboard-motivation-popup-dialog"
          role="dialog"
        >
          <button
            aria-label="Đóng chi tiết sự kiện"
            className="icon-action-button dashboard-motivation-popup-close"
            onClick={onClose}
            title="Đóng"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
          <div className="dashboard-motivation-popup-media">
            {images.map((imageUrl, index) => (
              <figure
                className="dashboard-motivation-popup-image-frame"
                key={imageUrl}
              >
                <button
                  className="dashboard-motivation-popup-image-button"
                  onClick={() => setViewImage(imageUrl)}
                  type="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={`${item.title} - hình ${index + 1}`}
                    className="dashboard-motivation-popup-image"
                    src={imageUrl}
                  />
                </button>
              </figure>
            ))}
          </div>
          <div className="dashboard-motivation-popup-copy">
            <p className="dashboard-motivation-popup-kicker">{typeLabel}</p>
            <h3 className="dashboard-motivation-popup-title">{item.title}</h3>
            <div className="dashboard-motivation-popup-tags">
              <span>{typeLabel}</span>
              {item.requireAck ? <span>Cần xác nhận</span> : null}
              <span>
                {item.displayChannel === "both"
                  ? "WebApp + Notifier"
                  : item.displayChannel === "notifier"
                    ? "Notifier"
                    : "WebApp"}
              </span>
            </div>
            {schedule ? (
              <p className="dashboard-motivation-popup-schedule">
                Thời gian: {schedule}
              </p>
            ) : null}
            {item.location ? (
              <p className="dashboard-motivation-popup-location">
                Địa điểm: {item.location}
              </p>
            ) : null}
            {item.body ? (
              <p className="dashboard-motivation-popup-note dashboard-note-rich">
                {renderMotivationRichText(item.body)}
              </p>
            ) : null}
            {item.targetUrl ? (
              <Link
                className="dashboard-motivation-popup-link"
                href={item.targetUrl}
                target={item.targetUrl.startsWith("http") ? "_blank" : undefined}
              >
                Mở liên kết
              </Link>
            ) : null}
            <ReactionRow item={item} variant="popup" />
          </div>
        </div>
      </div>
      {viewImage ? (
        <div
          aria-hidden="false"
          className="dashboard-motivation-image-viewer"
        >
          <button
            aria-label="Đóng hình"
            className="dashboard-motivation-image-viewer-backdrop"
            onClick={() => setViewImage(null)}
            type="button"
          />
          <div
            aria-label="Xem hình chi tiết"
            aria-modal="true"
            className="dashboard-motivation-image-viewer-dialog"
            role="dialog"
          >
            <button
              aria-label="Đóng hình"
              className="icon-action-button dashboard-motivation-image-viewer-close"
              onClick={() => setViewImage(null)}
              type="button"
            >
              ×
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={item.title}
              className="dashboard-motivation-image-viewer-image"
              src={viewImage}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function MotivationHero({
  forcedSelection,
  motivation,
  onCloseForcedSelection,
  onNewsCount,
}: {
  forcedSelection: MotivationItem | null;
  motivation: MotivationStage;
  onCloseForcedSelection: () => void;
  onNewsCount: (count: number) => void;
}) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [activeSlide, setActiveSlide] = useState<"events" | "message">(
    motivation.messages.length > 0 ? "message" : "events",
  );
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [selected, setSelected] = useState<MotivationItem | null>(null);
  const galleryTrackRef = useRef<HTMLDivElement>(null);
  const message = motivation.messages[messageIndex] ?? null;
  const events = motivation.notifications;
  const hasBoth = Boolean(message && events.length > 0);

  useEffect(() => {
    onNewsCount(events.length);
  }, [events.length, onNewsCount]);

  const activeSelection = selected ?? forcedSelection;

  const nextMessage = () => {
    if (motivation.messages.length < 2) return;
    setMessageIndex((index) => (index + 1) % motivation.messages.length);
    setNoteExpanded(false);
  };

  const goToSlide = (nextSlide: "events" | "message") => {
    setActiveSlide(nextSlide);
    const target = galleryTrackRef.current?.querySelector<HTMLElement>(
      nextSlide === "events"
        ? ".dashboard-hero-slide--events"
        : ".dashboard-hero-slide--message",
    );
    galleryTrackRef.current?.scrollTo({
      behavior: "smooth",
      left: target?.offsetLeft ?? 0,
    });
  };

  return (
    <>
      <aside
        aria-label="Động lực và thông báo"
        className="dashboard-hero-panel"
      >
        <div className="dashboard-hero-visual">
        {!message && events.length === 0 ? (
          <div className="dashboard-motivation-empty">
            Chưa có hình động lực sẵn sàng.
          </div>
        ) : (
          <div
            className={`dashboard-hero-gallery-shell${
              hasBoth ? " dashboard-hero-gallery-shell--split" : ""
            }`}
          >
            <div
              className="dashboard-hero-gallery-track"
              aria-label="Bản tin và thông điệp hôm nay"
              ref={galleryTrackRef}
            >
              {message ? (
                <section
                  className={`dashboard-hero-slide dashboard-hero-slide--message${
                    noteExpanded ? " is-note-expanded" : ""
                  }`}
                  onClick={() => setSelected(message)}
                  tabIndex={0}
                >
                  <div
                    aria-hidden="true"
                    className="dashboard-hero-slide-color"
                  />
                </section>
              ) : null}
              {events.length > 0 ? (
                <section className="dashboard-hero-slide dashboard-hero-slide--events">
                  <div className="dashboard-hero-slide-color" aria-hidden="true" />
                  <div className="dashboard-events-stage">
                    <div className="dashboard-events-intro">
                      <div className="dashboard-events-intro-head">
                        <p className="dashboard-events-kicker">Bản tin</p>
                        <div className="dashboard-events-toolbar">
                          <button
                            aria-label="Tải lại bản tin"
                            className="dashboard-hero-icon-button"
                            onClick={() => window.location.reload()}
                            type="button"
                          >
                            <svg aria-hidden="true" viewBox="0 0 24 24">
                              <path d="M20 5v6h-6" />
                              <path d="M20 11a8 8 0 1 1-2.34-5.66" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="dashboard-event-feed-shell">
                      {events.length > 0 ? (
                        <div className="dashboard-event-feed">
                          {events.map((item) => {
                            const cardImage =
                              item.thumbnailUrl || item.imageUrl;
                            const schedule = formatMotivationCompactSchedule(
                              item.startAt,
                              item.endAt,
                            );
                            return (
                            <article
                              className="dashboard-event-feed-card"
                              key={item.eventId}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelected(item);
                                }
                              }}
                              onClick={() => setSelected(item)}
                              role="button"
                              tabIndex={0}
                            >
                              <div className="dashboard-event-feed-card-media">
                                {cardImage ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    alt=""
                                    className="dashboard-event-feed-card-image"
                                    src={cardImage}
                                  />
                                ) : (
                                  <div className="dashboard-event-feed-card-placeholder">
                                    {item.kind === "notice"
                                      ? "Thông báo"
                                      : "Sự kiện"}
                                  </div>
                                )}
                              </div>
                              <div className="dashboard-event-feed-card-body">
                                <div className="dashboard-event-feed-card-head">
                                  <p className="dashboard-event-feed-card-kicker">
                                    {item.kind === "notice"
                                      ? "Thông báo nội bộ"
                                      : "Sự kiện nội bộ"}
                                  </p>
                                  <span
                                    aria-hidden="true"
                                    className="dashboard-event-feed-card-status"
                                  />
                                </div>
                                <h3 className="dashboard-event-feed-card-title">
                                  {item.title}
                                </h3>
                                {schedule ? (
                                  <p className="dashboard-event-feed-card-schedule">
                                    <svg aria-hidden="true" viewBox="0 0 24 24">
                                      <circle cx="12" cy="12" r="8.5" />
                                      <path d="M12 7.5v5l3.25 2" />
                                    </svg>
                                    <span>{schedule}</span>
                                  </p>
                                ) : null}
                                <div className="dashboard-event-feed-card-tags">
                                  {item.location ? (
                                    <span>
                                      <svg aria-hidden="true" viewBox="0 0 24 24">
                                        <path d="M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11Z" />
                                        <circle cx="12" cy="10" r="2" />
                                      </svg>
                                      {item.location}
                                    </span>
                                  ) : null}
                                  {item.requireAck ? (
                                    <span>Cần xác nhận</span>
                                  ) : null}
                                </div>
                                <span className="dashboard-event-feed-card-cta">
                                  <span>Xem chi tiết</span>
                                  <svg aria-hidden="true" viewBox="0 0 24 24">
                                    <path d="M5 12h13" />
                                    <path d="m13 7 5 5-5 5" />
                                  </svg>
                                </span>
                              </div>
                            </article>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="dashboard-event-feed-empty">
                          Hôm nay chưa có bản tin mới.
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
            <div
              className={`dashboard-message-dock-overlay${
                activeSlide === "message" && message ? " is-visible" : ""
              }${noteExpanded ? " is-note-expanded" : ""}`}
              onClick={() => {
                if (message) setSelected(message);
              }}
            >
              {activeSlide === "message" && message ? (
                <div className="dashboard-message-bottom-stack">
                  <div className="dashboard-message-head-actions">
                    <button
                      aria-label="Tải lời nhắn khác"
                      className="dashboard-hero-icon-button dashboard-hero-icon-button--dock"
                      onClick={(event) => {
                        event.stopPropagation();
                        nextMessage();
                      }}
                      type="button"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M20 5v6h-6" />
                        <path d="M20 11a8 8 0 1 1-2.34-5.66" />
                      </svg>
                    </button>
                    <ReactionRow item={message} variant="hero" />
                    {message.body ? (
                      <button
                        aria-expanded={noteExpanded}
                        aria-label={
                          noteExpanded ? "Thu gọn ghi chú" : "Mở ghi chú"
                        }
                        className={`dashboard-note-toggle-button${
                          noteExpanded ? " is-active" : ""
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setNoteExpanded((value) => !value);
                        }}
                        type="button"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path
                            d={
                              noteExpanded
                                ? "M7 10l5 5 5-5"
                                : "M7 14l5-5 5 5"
                            }
                          />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                  <div
                    className={`dashboard-message-panel${
                      noteExpanded ? " is-note-expanded" : ""
                    }`}
                  >
                    <div className="dashboard-message-head">
                      <p className="motivation-kicker">
                        Thông điệp gửi bạn
                      </p>
                    </div>
                    <div className="dashboard-message-copy">
                      <p className="motivation-text">{message.title}</p>
                    </div>
                    {message.body ? (
                      <div
                        className={`dashboard-message-note-sheet${
                          noteExpanded ? " is-expanded" : ""
                        }`}
                      >
                        <p className="dashboard-message-note-text dashboard-note-rich">
                          {renderMotivationRichText(message.body)}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            {hasBoth ? (
              <div
                className="dashboard-hero-gallery-arrows"
                aria-label="Chuyển trang bản tin"
              >
                <button
                  aria-label="Về bản tin"
                  className={`dashboard-hero-gallery-arrow dashboard-hero-gallery-arrow--prev${
                    activeSlide === "events" ? " is-hidden" : ""
                  }`}
                  disabled={activeSlide === "events"}
                  onClick={() => goToSlide("events")}
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
                </button>
                <button
                  aria-label="Sang thông điệp"
                  className={`dashboard-hero-gallery-arrow dashboard-hero-gallery-arrow--next${
                    activeSlide === "message" ? " is-hidden" : ""
                  }`}
                  disabled={activeSlide === "message"}
                  onClick={() => goToSlide("message")}
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
            ) : null}
          </div>
        )}
          <svg
            aria-hidden="true"
            className="dashboard-touchpoint-watermark"
            preserveAspectRatio="xMidYMid meet"
            viewBox="400 350 400 280"
          >
            <image
              height="1200"
              href="/login-logo.png"
              preserveAspectRatio="xMidYMid meet"
              width="1200"
              x="0"
              y="0"
            />
          </svg>
        </div>
      </aside>
      <section
        aria-label="Sự kiện và thông báo"
        className={`dashboard-mobile-feed${
          events.length > 0 ? "" : " is-hidden"
        }`}
      >
        <div className="dashboard-mobile-feed-track">
          {events.map((item) => (
            <article
              className="dashboard-mobile-feed-card"
              key={item.eventId}
              onClick={() => setSelected(item)}
            >
              {item.thumbnailUrl || item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="dashboard-mobile-feed-card-image"
                  src={item.thumbnailUrl || item.imageUrl || ""}
                />
              ) : null}
              <h3 className="dashboard-mobile-feed-card-title">{item.title}</h3>
            </article>
          ))}
        </div>
      </section>
      {activeSelection ? (
        <MotivationDetail
          item={activeSelection}
          onClose={() => {
            setSelected(null);
            onCloseForcedSelection();
          }}
        />
      ) : null}
    </>
  );
}

const initialAccountState: AccountActionState = {};

function readSoundSettings() {
  if (typeof window === "undefined") {
    return { sound: "clear-chime", volume: 90 };
  }
  try {
    const saved = JSON.parse(
      localStorage.getItem("hc-admin-notification-settings-v1") || "{}",
    ) as { sound?: string; volume?: number };
    return {
      sound: saved.sound || "clear-chime",
      volume: Number(saved.volume ?? 90),
    };
  } catch {
    return { sound: "clear-chime", volume: 90 };
  }
}

function DashboardDialogs({
  accountOpen,
  closeAccount,
  closeNotifier,
  closeSound,
  notifierOpen,
  soundOpen,
}: {
  accountOpen: boolean;
  closeAccount: () => void;
  closeNotifier: () => void;
  closeSound: () => void;
  notifierOpen: boolean;
  soundOpen: boolean;
}) {
  const { toast } = useToast();
  const [accountState, accountAction, accountPending] = useActionState(
    changePasswordAction,
    initialAccountState,
  );
  const [volume, setVolume] = useState(() => readSoundSettings().volume);
  const [sound, setSound] = useState(() => readSoundSettings().sound);
  const [permissionStatus, setPermissionStatus] = useState("");
  const [pairCode, setPairCode] = useState<NotifierPairCode | null>(null);
  const [pairStatus, setPairStatus] = useState("");
  const [pairError, setPairError] = useState(false);
  const pairPending = notifierOpen && !pairCode && !pairError;

  useEffect(() => {
    if (accountState.success) {
      toast({
        message: accountState.success,
        title: "Đổi mật khẩu",
        tone: "success",
      });
    } else if (accountState.error) {
      toast({
        message: accountState.error,
        title: "Không thể đổi mật khẩu",
        tone: "error",
      });
    }
  }, [accountState, toast]);

  useEffect(() => {
    if (!notifierOpen) return;
    let cancelled = false;
    void createNotifierPairCodeAction(navigator.userAgent.slice(0, 160))
      .then((result) => {
        if (cancelled) return;
        setPairCode(result);
        setPairError(false);
        setPairStatus(
          "Mã ghép máy đã sẵn sàng. Mã chỉ dùng một lần trong 5 phút.",
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPairError(true);
        setPairStatus(
          error instanceof Error
            ? error.message
            : "Chưa tạo được mã ghép máy. Ông thử lại giúp tui nhé.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [notifierOpen]);

  const requestPairCode = () => {
    setPairCode(null);
    setPairError(false);
    setPairStatus("Đang tạo mã ghép máy mới...");
    void createNotifierPairCodeAction(navigator.userAgent.slice(0, 160))
      .then((result) => {
        setPairCode(result);
        setPairStatus(
          "Mã ghép máy đã sẵn sàng. Mã chỉ dùng một lần trong 5 phút.",
        );
      })
      .catch((error: unknown) => {
        setPairError(true);
        setPairStatus(
          error instanceof Error
            ? error.message
            : "Chưa tạo được mã ghép máy. Ông thử lại giúp tui nhé.",
        );
      });
  };

  const closeNotifierDialog = () => {
    setPairCode(null);
    setPairStatus("");
    setPairError(false);
    closeNotifier();
  };

  const pairExpiry = pairCode
    ? `Hiệu lực đến ${new Date(pairCode.expiresAt).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      })} - ${new Date(pairCode.expiresAt).toLocaleDateString("vi-VN")}`
    : "Hiệu lực 5 phút";

  const saveSound = (nextVolume: number, nextSound: string) => {
    localStorage.setItem(
      "hc-admin-notification-settings-v1",
      JSON.stringify({ sound: nextSound, volume: nextVolume }),
    );
  };

  const testSound = () => {
    const AudioContextClass =
      window.AudioContext ||
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AudioContextClass || volume === 0) {
      toast({
        message: "Trình duyệt chưa cho phép phát âm thanh.",
        title: "Nghe thử",
        tone: "warning",
      });
      return;
    }
    const context = new AudioContextClass();
    const gain = context.createGain();
    gain.gain.value = Math.max(0.01, volume / 220);
    gain.connect(context.destination);
    [660, 820, 980, 820].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(context.currentTime + index * 0.16);
      oscillator.stop(context.currentTime + index * 0.16 + 0.13);
    });
    window.setTimeout(() => void context.close(), 1100);
  };

  return (
    <>
      {accountOpen ? (
        <div className="account-password-modal" aria-hidden="false">
          <button
            aria-label="Đóng đổi mật khẩu"
            className="permission-modal-backdrop"
            onClick={closeAccount}
            type="button"
          />
          <section
            aria-labelledby="accountPasswordTitle"
            aria-modal="true"
            className="account-password-dialog"
            role="dialog"
          >
            <header className="permission-modal-header">
              <div className="permission-modal-title-wrap">
                <p className="section-tag">Tài khoản</p>
                <h2
                  className="permission-modal-title"
                  id="accountPasswordTitle"
                >
                  Đổi mật khẩu
                </h2>
              </div>
              <button
                aria-label="Đóng đổi mật khẩu"
                className="drawer-close-button permission-close-button ui-close-button"
                onClick={closeAccount}
                type="button"
              >
                ×
              </button>
            </header>
            <form action={accountAction} className="account-password-form">
              <div className="field-group">
                <label className="field-label" htmlFor="accountCurrentPassword">
                  Mật khẩu hiện tại
                </label>
                <input
                  autoComplete="current-password"
                  className="text-input"
                  id="accountCurrentPassword"
                  name="currentPassword"
                  placeholder="Nhập mật khẩu hiện tại"
                  type="password"
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="accountNewPassword">
                  Mật khẩu mới
                </label>
                <input
                  autoComplete="new-password"
                  className="text-input"
                  id="accountNewPassword"
                  name="password"
                  placeholder="Mật khẩu mới có chữ in hoa, số và ký hiệu"
                  type="password"
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="accountConfirmPassword">
                  Nhập lại mật khẩu mới
                </label>
                <input
                  autoComplete="new-password"
                  className="text-input"
                  id="accountConfirmPassword"
                  name="confirm"
                  placeholder="Nhập lại mật khẩu mới"
                  type="password"
                />
              </div>
              <p
                className={`permission-status${
                  accountState.error
                    ? " is-error"
                    : accountState.success
                      ? " is-success"
                      : ""
                }`}
                role="status"
              >
                {accountState.error || accountState.success || ""}
              </p>
              <div className="permission-form-actions">
                <button
                  className={`primary-button permission-save-button ui-button ui-button--primary${
                    accountPending ? " is-loading" : ""
                  }`}
                  disabled={accountPending}
                  type="submit"
                >
                  <span className="primary-button-label">
                    {accountPending ? "Đang cập nhật..." : "Cập nhật mật khẩu"}
                  </span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {soundOpen ? (
        <div
          aria-hidden="false"
          className="account-password-modal notification-settings-modal"
        >
          <button
            aria-label="Đóng cài đặt thông báo"
            className="permission-modal-backdrop"
            onClick={closeSound}
            type="button"
          />
          <section
            aria-labelledby="notificationSettingsTitle"
            aria-modal="true"
            className="account-password-dialog notification-settings-dialog"
            role="dialog"
          >
            <header className="permission-modal-header">
              <div className="permission-modal-title-wrap">
                <p className="section-tag">Âm báo Admin</p>
                <h2
                  className="permission-modal-title"
                  id="notificationSettingsTitle"
                >
                  Cài đặt thông báo
                </h2>
              </div>
              <button
                aria-label="Đóng cài đặt thông báo"
                className="drawer-close-button permission-close-button ui-close-button"
                onClick={closeSound}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="notification-settings-form">
              <div className="notification-settings-card">
                <label className="field-label" htmlFor="notificationVolumeInput">
                  Âm lượng thông báo
                </label>
                <div className="notification-volume-row">
                  <input
                    className="notification-volume-input"
                    id="notificationVolumeInput"
                    max="100"
                    min="0"
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setVolume(next);
                      saveSound(next, sound);
                    }}
                    step="5"
                    type="range"
                    value={volume}
                  />
                  <span className="notification-volume-value">{volume}%</span>
                </div>
              </div>
              <div className="notification-settings-card">
                <label className="field-label" htmlFor="notificationSoundSelect">
                  Âm thanh thông báo
                </label>
                <select
                  className="select-input notification-sound-select"
                  id="notificationSoundSelect"
                  onChange={(event) => {
                    setSound(event.target.value);
                    saveSound(volume, event.target.value);
                  }}
                  value={sound}
                >
                  <option value="warm-bell">Chuông ấm kéo dài</option>
                  <option value="clear-chime">Chuông rõ 4 nhịp</option>
                  <option value="office-ping">Ping văn phòng dài</option>
                  <option value="soft-alarm">Báo mềm 2 hồi</option>
                  <option value="bright-rise">Âm sáng tăng dần</option>
                </select>
              </div>
              <div className="notification-settings-actions">
                <button
                  className="secondary-button notification-test-button"
                  onClick={testSound}
                  type="button"
                >
                  Nghe thử
                </button>
                <button
                  className="primary-button notification-permission-button ui-button ui-button--primary"
                  onClick={async () => {
                    if (!("Notification" in window)) {
                      setPermissionStatus(
                        "Trình duyệt này không hỗ trợ Notifications.",
                      );
                      return;
                    }
                    const result = await Notification.requestPermission();
                    setPermissionStatus(
                      result === "granted"
                        ? "Đã cho phép Notifications."
                        : "Trình duyệt đang chặn Notifications cho trang này.",
                    );
                  }}
                  type="button"
                >
                  <span className="primary-button-label">
                    Yêu cầu quyền Notifications
                  </span>
                </button>
              </div>
              <p
                className="permission-status notification-settings-status"
                role="status"
              >
                {permissionStatus}
              </p>
            </div>
          </section>
        </div>
      ) : null}

      {notifierOpen ? (
        <div
          aria-hidden="false"
          className="account-password-modal notifier-pair-modal"
        >
          <button
            aria-label="Đóng kết nối Thuần Việt Notifier"
            className="permission-modal-backdrop"
            onClick={closeNotifierDialog}
            type="button"
          />
          <section
            aria-labelledby="notifierPairTitle"
            aria-modal="true"
            className="account-password-dialog notifier-pair-dialog"
            role="dialog"
          >
            <header className="permission-modal-header">
              <div className="permission-modal-title-wrap notifier-pair-title-wrap">
                <p className="section-tag">Kết nối thiết bị</p>
                <h2 className="permission-modal-title" id="notifierPairTitle">
                  Thuần Việt Notifier
                </h2>
              </div>
              <button
                aria-label="Đóng kết nối Thuần Việt Notifier"
                className="drawer-close-button permission-close-button ui-close-button"
                onClick={closeNotifierDialog}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="notifier-pair-shell">
              <div className="notifier-pair-brand-card">
                <span className="notifier-pair-brand-mark">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    className="notifier-pair-brand-image"
                    src="/logo.png"
                  />
                </span>
                <div className="notifier-pair-brand-copy">
                  <p className="notifier-pair-brand-kicker">
                    Ứng dụng nhận thông báo
                  </p>
                  <div className="notifier-pair-brand-title">
                    Thuần Việt Notifier
                  </div>
                </div>
                <div
                  aria-label="Chọn hệ điều hành để tải"
                  className="notifier-pair-download-options"
                >
                  <a
                    aria-label="Tải bản Windows"
                    className="secondary-button notifier-pair-download-button"
                    href={NOTIFIER_WINDOWS_URL}
                    rel="noopener"
                    target="_blank"
                    title="Tải bản Windows"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <rect height="7" width="7" x="3.5" y="4" />
                      <rect height="7" width="7" x="13.5" y="4" />
                      <rect height="7" width="7" x="3.5" y="13" />
                      <rect height="7" width="7" x="13.5" y="13" />
                    </svg>
                    <span className="notifier-pair-download-os">Win</span>
                  </a>
                  <a
                    aria-label="Tải bản macOS"
                    className="secondary-button notifier-pair-download-button"
                    href={NOTIFIER_MAC_URL}
                    rel="noopener"
                    target="_blank"
                    title="Tải bản macOS"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M5 16.5h14" />
                      <path d="M7 16.5V7.8c0-.9.7-1.6 1.6-1.6h6.8c.9 0 1.6.7 1.6 1.6v8.7" />
                      <path d="M4 18.8h16" />
                    </svg>
                    <span className="notifier-pair-download-os">Mac</span>
                  </a>
                </div>
              </div>
              <div className="notifier-pair-code-card">
                <div className="notifier-pair-code-head">
                  <span className="field-label notifier-pair-code-label">
                    Mã ghép máy
                  </span>
                  <button
                    aria-label="Tạo mã mới"
                    className="icon-action-button notifier-pair-refresh-button"
                    disabled={pairPending}
                    onClick={requestPairCode}
                    title="Tạo mã mới"
                    type="button"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M20 5v6h-6" />
                      <path d="M20 11a8 8 0 1 1-2.34-5.66" />
                    </svg>
                  </button>
                </div>
                <div className="notifier-pair-code-value">
                  {pairCode?.displayPairCode || "--- ---"}
                </div>
                <div className="notifier-pair-expire">{pairExpiry}</div>
                <div className="notifier-pair-actions">
                  <button
                    className="secondary-button notifier-pair-copy-button"
                    disabled={!pairCode || pairPending}
                    onClick={async () => {
                      if (!pairCode) {
                        setPairError(true);
                        setPairStatus("Chưa có mã ghép máy để sao chép.");
                        return;
                      }
                      try {
                        await navigator.clipboard.writeText(
                          pairCode.displayPairCode,
                        );
                        setPairError(false);
                        setPairStatus(
                          "Đã sao chép mã ghép máy. Ông dán vào app là chạy được ngay.",
                        );
                      } catch {
                        setPairError(false);
                        setPairStatus(
                          "Trình duyệt không cho sao chép tự động. Ông copy thủ công giúp tui nhé.",
                        );
                      }
                    }}
                    type="button"
                  >
                    Sao chép mã
                  </button>
                  <button
                    className="primary-button notifier-pair-open-button"
                    onClick={() =>
                      window.open(
                        window.location.origin,
                        "_blank",
                        "noopener",
                      )
                    }
                    type="button"
                  >
                    Mở cổng nội bộ
                  </button>
                </div>
              </div>
              <p
                className={`permission-status notifier-pair-status${
                  pairError ? " is-error" : pairCode ? " is-success" : " is-info"
                }`}
                role="status"
              >
                {pairStatus ||
                  (pairPending ? "Đang tạo mã ghép máy mới..." : "")}
              </p>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function LegacyPortalDashboard({
  canAdminNotify,
  displayName,
  featureGroups,
  greeting,
  motivation,
}: {
  canAdminNotify: boolean;
  displayName: string;
  featureGroups: LegacyFeatureGroup[];
  greeting: string;
  motivation: MotivationStage;
}) {
  const [query, setQuery] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifierOpen, setNotifierOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [newsCount, setNewsCount] = useState(0);
  const [forcedNews, setForcedNews] = useState<MotivationItem | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const topbar = useRef<HTMLElement>(null);
  const dailySection = useRef<HTMLElement>(null);

  useEffect(() => {
    document.body.classList.add("dashboard-mode");
    const updateTone = () => {
      if (!topbar.current || !dailySection.current) return;
      topbar.current.classList.toggle(
        "is-touchpoint-active",
        dailySection.current.getBoundingClientRect().bottom <=
          topbar.current.getBoundingClientRect().bottom + 8,
      );
    };
    window.addEventListener("scroll", updateTone, true);
    updateTone();
    return () => {
      document.body.classList.remove("dashboard-mode");
      window.removeEventListener("scroll", updateTone, true);
    };
  }, []);

  return (
    <>
      {/* CSS được trích nguyên bản từ AppStyles của GAS để giữ parity 1:1. */}
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link
        href="/legacy/index-services-parity.css"
        rel="stylesheet"
      />
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link href="/legacy/portal-brand-v3.css" rel="stylesheet" />
      <NotifierMount notifications={motivation.notifications} />
      <PortalPresenceDrawer />
      <div className="app-root" data-view="dashboard" id="appRoot">
        <section className="dashboard-shell view-screen" id="dashboardView">
          <header className="dashboard-topbar" ref={topbar}>
            <div className="dashboard-topbar-greeting">
              <span>Không gian làm việc</span>
              <h1 className="dashboard-greeting">{greeting}</h1>
            </div>
            <form
              aria-label="Tìm kiếm module"
              className="dashboard-module-search dashboard-module-search--topbar"
              onSubmit={(event) => {
                event.preventDefault();
                document
                  .querySelector<HTMLElement>(".feature-card")
                  ?.focus({ preventScroll: false });
              }}
              role="search"
            >
              <label
                className="dashboard-module-search-label"
                htmlFor="dashboardModuleSearchInput"
              >
                Tìm kiếm module
              </label>
              <input
                autoComplete="off"
                className="dashboard-module-search-input"
                id="dashboardModuleSearchInput"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm module cần mở"
                ref={searchInput}
                type="search"
                value={query}
              />
              <button
                aria-label="Tìm module"
                className="dashboard-module-search-button"
                type="submit"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="6" />
                  <path d="m16 16 4 4" />
                </svg>
              </button>
            </form>
            <div className="dashboard-actions">
              <button
                aria-label="Kết nối Thuần Việt Notifier"
                className="icon-action-button notifier-pair-launch-button"
                onClick={() => setNotifierOpen(true)}
                title="Kết nối Thuần Việt Notifier"
                type="button"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  className="notifier-pair-launch-icon"
                  src="/logo.png"
                />
              </button>
              <button
                aria-label="Đổi mật khẩu"
                className="icon-action-button"
                onClick={() => setAccountOpen(true)}
                title="Đổi mật khẩu"
                type="button"
              >
                <span aria-hidden="true">&#9881;</span>
              </button>
              {canAdminNotify ? (
                <button
                  aria-label="Cài đặt âm báo"
                  className="icon-action-button notification-settings-button"
                  onClick={() => setSoundOpen(true)}
                  title="Cài đặt âm báo"
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M4 10v4h4l5 4V6l-5 4H4z" />
                    <path d="M16 9.5a4 4 0 0 1 0 5" />
                    <path d="M18.5 7a7.5 7.5 0 0 1 0 10" />
                  </svg>
                </button>
              ) : null}
              {newsCount > 0 ? (
                <button
                  aria-label={`Mở ${newsCount} bản tin hôm nay`}
                  className="dashboard-news-button"
                  onClick={() =>
                    setForcedNews(motivation.notifications[0] ?? null)
                  }
                  title="Mở bản tin hôm nay"
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                    <path d="M10 21h4" />
                  </svg>
                  <span>Bản tin</span>
                  <strong>{newsCount}</strong>
                </button>
              ) : null}
              <form action={logoutAction}>
                <button
                  aria-label="Đổi tài khoản"
                  className="dashboard-account-button"
                  title="Đổi tài khoản"
                  type="submit"
                >
                  <span className="dashboard-account-avatar" aria-hidden="true">
                    {initials(displayName)}
                  </span>
                  <span className="dashboard-account-label">{displayName}</span>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M7 10l5 5 5-5" />
                  </svg>
                </button>
              </form>
            </div>
          </header>
          <main className="dashboard-workspace">
            <section
              aria-label="Động lực và thông báo hôm nay"
              className="dashboard-daily-section"
              ref={dailySection}
            >
              <MotivationHero
                forcedSelection={forcedNews}
                motivation={motivation}
                onCloseForcedSelection={() => setForcedNews(null)}
                onNewsCount={setNewsCount}
              />
            </section>
            <section
              className="dashboard-modules-section"
              data-dashboard-section="modules"
            >
              <div className="dashboard-section-heading dashboard-section-heading--modules">
                <div>
                  <p className="dashboard-section-kicker">Ứng dụng</p>
                  <h2>Khu vực chức năng</h2>
                </div>
              </div>
              <div className="feature-groups" id="featureGroups">
                {featureGroups.length > 0 ? (
                  <LegacyFeatureGroups groups={featureGroups} query={query} />
                ) : (
                  <section className="empty-state">
                    <h3 className="empty-state-title">
                      Chưa có chức năng được cấp
                    </h3>
                    <p className="empty-state-text">
                      Tài khoản này hiện chỉ có quyền cơ bản hoặc chưa có module
                      nào được bật thêm.
                    </p>
                  </section>
                )}
              </div>
            </section>
          </main>
        </section>
      </div>
      <DashboardDialogs
        accountOpen={accountOpen}
        closeAccount={() => setAccountOpen(false)}
        closeNotifier={() => setNotifierOpen(false)}
        closeSound={() => setSoundOpen(false)}
        notifierOpen={notifierOpen}
        soundOpen={soundOpen}
      />
    </>
  );
}
