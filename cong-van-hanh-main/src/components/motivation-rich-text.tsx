import type { ReactNode } from "react";

const COLOR_CLASS: Record<string, string> = {
  do: "text-[#c62828]",
  hong: "text-[#d63384]",
  xanhduong: "text-[#123d8f]",
  xanhreu: "text-[#4d7c0f]",
};

export function renderMotivationRichText(text: string): ReactNode {
  const tokens = text.split(
    /(\[\/?(?:hong|do|xanhduong|xanhreu)\]|\*\*|__|\*)/g,
  );
  let color = "";
  let bold = false;
  let italic = false;
  let underline = false;
  let key = 0;

  return tokens.flatMap((token) => {
    if (!token) return [];
    const colorTag = token.match(/^\[(\/?)(hong|do|xanhduong|xanhreu)\]$/);
    if (colorTag) {
      color = colorTag[1] ? "" : COLOR_CLASS[colorTag[2]];
      return [];
    }
    if (token === "**") {
      bold = !bold;
      return [];
    }
    if (token === "*") {
      italic = !italic;
      return [];
    }
    if (token === "__") {
      underline = !underline;
      return [];
    }

    return [
      <span
        className={`${color}${bold ? " font-black" : ""}${
          italic ? " italic" : ""
        }${underline ? " underline underline-offset-2" : ""}`}
        key={key++}
      >
        {token}
      </span>,
    ];
  });
}

