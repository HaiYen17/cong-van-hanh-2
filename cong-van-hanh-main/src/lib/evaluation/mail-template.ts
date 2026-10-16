const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "s",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

const VOID_TAGS = new Set(["br", "hr"]);

const ALLOWED_STYLE_PROPERTIES = new Set([
  "background-color",
  "border",
  "border-bottom",
  "border-collapse",
  "border-left",
  "border-radius",
  "border-right",
  "border-top",
  "color",
  "display",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-width",
  "min-width",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "text-decoration",
  "vertical-align",
  "width",
]);

function cleanStyle(value: string) {
  return value
    .split(";")
    .map((entry) => {
      const separator = entry.indexOf(":");
      if (separator < 1) return "";
      const property = entry.slice(0, separator).trim().toLowerCase();
      const styleValue = entry.slice(separator + 1).trim();
      if (
        !ALLOWED_STYLE_PROPERTIES.has(property) ||
        !styleValue ||
        styleValue.length > 180 ||
        /(?:url\s*\(|expression\s*\(|javascript:|data:|behavior\s*:|@import|[<>\\])/i.test(
          styleValue,
        )
      ) {
        return "";
      }
      return `${property}:${styleValue}`;
    })
    .filter(Boolean)
    .join(";");
}

function cleanHref(value: string) {
  const href = value.trim();
  if (href === "{{link_danh_gia}}") return href;
  if (/^(?:https?:|mailto:)/i.test(href)) return href;
  return "";
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeAttributes(tag: string, source: string) {
  const attributes: string[] = [];
  const pattern =
    /([a-zA-Z][a-zA-Z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name === "style") {
      const style = cleanStyle(value);
      if (style) attributes.push(`style="${escapeAttribute(style)}"`);
      continue;
    }
    if (tag === "a" && name === "href") {
      const href = cleanHref(value);
      if (href) attributes.push(`href="${escapeAttribute(href)}"`);
    }
  }

  if (tag === "a" && attributes.some((attribute) => attribute.startsWith("href="))) {
    attributes.push('target="_blank"', 'rel="noopener"');
  }

  return attributes.length ? ` ${attributes.join(" ")}` : "";
}

export function sanitizeEvaluationMailHtml(value: unknown) {
  let html = String(value ?? "").slice(0, 120_000);
  html = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|iframe|object|embed|form|button|svg|math|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(
      /<(input|link|meta|img|source|video|audio)\b[^>]*\/?>/gi,
      "",
    );

  return html
    .replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)\b([^>]*)>/g, (
      _match,
      closing: string,
      rawTag: string,
      rawAttributes: string,
    ) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return "";
      if (closing) return VOID_TAGS.has(tag) ? "" : `</${tag}>`;
      return `<${tag}${sanitizeAttributes(tag, rawAttributes)}>`;
    })
    .trim();
}

function decodeEntities(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(entities, name.toLowerCase())
        ? entities[name.toLowerCase()]
        : match,
    );
}

export function evaluationMailHtmlToText(value: unknown) {
  return decodeEntities(
    sanitizeEvaluationMailHtml(value)
      .replace(/<br\s*>/gi, "\n")
      .replace(/<\/(?:p|div|h1|h2|h3|blockquote|li|tr)>/gi, "\n")
      .replace(/<li(?:\s[^>]*)?>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
