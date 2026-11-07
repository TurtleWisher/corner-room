"use client";

/*
 * Where artists write an email (owner, 2026-11-02, D-MAIL-02): the fill-ins show as the real words
 * for the buyer being previewed (highlighted, so it's clear each buyer gets their own), and links
 * sit inside the text: select words, tap Link, paste the address. What's saved is plain text with
 * {first_name}-style fill-ins and [words](https://address) links, the shape the server writes out
 * (`lib/artist-mail-view.ts` parseRich). Plain text only: pasting drops formatting.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link2, Link2Off } from "lucide-react";

import { ALL_FILL_KEYS, FILL_INS, GIFT_UPDATE_FILL_INS, parseRich, type FillKey, type MailValues } from "@/lib/artist-mail-view";

const FILL_HINT = Object.fromEntries(GIFT_UPDATE_FILL_INS.map((f) => [f.key, f.hint])) as Record<FillKey, string>;

function chip(key: FillKey, values: MailValues): HTMLElement {
  const el = document.createElement("span");
  el.contentEditable = "false";
  el.dataset.fill = key;
  el.className = "am-chip";
  el.title = FILL_HINT[key];
  el.textContent = values[key] ?? `{${key}}`;
  return el;
}

function linkEl(label: string, url: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.dataset.href = url;
  a.href = url;
  a.className = "am-link";
  a.textContent = label;
  a.title = url;
  return a;
}

/** Fill the editor from saved text. */
function render(el: HTMLElement, text: string, values: MailValues) {
  el.replaceChildren();
  for (const token of parseRich(text)) {
    if (token.kind === "fill") el.append(chip(token.key, values));
    else if (token.kind === "link") el.append(linkEl(token.label, token.url));
    else {
      token.text.split("\n").forEach((part, i) => {
        if (i > 0) el.append(document.createElement("br"));
        if (part) el.append(document.createTextNode(part));
      });
    }
  }
  // A trailing line break needs a second <br> to show as an empty line.
  if (text.endsWith("\n")) el.append(document.createElement("br"));
}

/** Read the editor back into saved text. */
function serialize(root: Node): string {
  let out = "";
  const walk = (node: Node, top: boolean) => {
    node.childNodes.forEach((child, index) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.textContent ?? "").replace(/ /g, " ");
        return;
      }
      if (!(child instanceof HTMLElement)) return;
      if (child.dataset.fill && ALL_FILL_KEYS.includes(child.dataset.fill as FillKey)) {
        out += `{${child.dataset.fill}}`;
        return;
      }
      if (child.tagName === "BR") {
        out += "\n";
        return;
      }
      if (child.tagName === "A" && child.dataset.href) {
        const label = (child.textContent ?? "").replace(/[[\]\n]/g, " ").trim();
        out += label ? `[${label}](${child.dataset.href})` : "";
        return;
      }
      // A browser may wrap new lines in <div>s: each starts a new line.
      if ((child.tagName === "DIV" || child.tagName === "P") && top && index > 0 && !out.endsWith("\n")) out += "\n";
      walk(child, false);
    });
  };
  walk(root, true);
  return out.replace(/\n$/, "");
}

function insertNode(node: Node) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function RichEditor({
  value,
  onChange,
  values,
  label,
  singleLine = false,
  placeholder,
  invalid,
  fillIns = FILL_INS,
}: {
  value: string;
  onChange: (next: string) => void;
  values: MailValues;
  label: string;
  singleLine?: boolean;
  placeholder?: string;
  invalid?: boolean;
  /** The fill-in buttons and their words (music gifts name {music} as what is given). */
  fillIns?: typeof FILL_INS;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const saved = useRef<Range | null>(null);
  const [linking, setLinking] = useState<{ url: string; hasSelection: boolean } | null>(null);
  const [inLink, setInLink] = useState<HTMLAnchorElement | null>(null);
  const labelId = useId();

  // Outside changes (a starter, a template) redraw the editor; typing doesn't.
  useEffect(() => {
    const el = ref.current;
    if (!el || value === emitted.current) return;
    render(el, value, values);
    emitted.current = value;
    // values are applied below without redrawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Previewing as someone else changes the words in the highlighted fill-ins only.
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>("[data-fill]").forEach((el) => {
      el.textContent = values[el.dataset.fill as FillKey] ?? el.textContent;
    });
  }, [values]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = serialize(el);
    emitted.current = next;
    onChange(next);
  }, [onChange]);

  const remember = () => {
    const sel = window.getSelection();
    const el = ref.current;
    if (sel && sel.rangeCount && el && el.contains(sel.anchorNode)) {
      saved.current = sel.getRangeAt(0).cloneRange();
      const node = sel.anchorNode instanceof HTMLElement ? sel.anchorNode : sel.anchorNode?.parentElement;
      setInLink((node?.closest("a[data-href]") as HTMLAnchorElement | null) ?? null);
    }
  };

  const restore = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && saved.current) {
      sel.removeAllRanges();
      sel.addRange(saved.current);
    } else if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const addFill = (key: FillKey) => {
    restore();
    insertNode(chip(key, values));
    emit();
    remember();
  };

  const startLink = () => {
    restore();
    const text = window.getSelection()?.toString() ?? "";
    setLinking({ url: "https://", hasSelection: text.trim().length > 0 });
  };

  const finishLink = () => {
    if (!linking) return;
    const url = linking.url.trim();
    if (!/^https?:\/\/\S+\.\S+/.test(url)) return;
    restore();
    const sel = window.getSelection();
    const text = (sel?.toString() ?? "").replace(/\n/g, " ").trim();
    insertNode(linkEl(text || url.replace(/^https?:\/\//, ""), url));
    setLinking(null);
    emit();
  };

  const removeLink = () => {
    if (!inLink) return;
    inLink.replaceWith(document.createTextNode(inLink.textContent ?? ""));
    setInLink(null);
    emit();
  };

  return (
    <div className="am-editor">
      <span id={labelId} className="text-[0.8125rem] font-semibold text-fg">
        {label}
      </span>
      <div className="am-tools mt-2" role="toolbar" aria-label={`Add to ${label.toLowerCase()}`}>
        {fillIns.filter((f) => !singleLine || f.key !== "buyer_name").map((f) => (
          <button key={f.key} type="button" className="am-tool" onMouseDown={(e) => e.preventDefault()} onClick={() => addFill(f.key)} title={f.hint}>
            + {f.label}
          </button>
        ))}
        {singleLine ? null : inLink ? (
          <button type="button" className="am-tool" onMouseDown={(e) => e.preventDefault()} onClick={removeLink}>
            <Link2Off aria-hidden="true" className="size-3.5" /> Remove link
          </button>
        ) : (
          <button type="button" className="am-tool" onMouseDown={(e) => e.preventDefault()} onClick={startLink}>
            <Link2 aria-hidden="true" className="size-3.5" /> Link
          </button>
        )}
      </div>
      {linking ? (
        <div className="am-linkbar mt-2" role="group" aria-label="Add a link">
          <span className="text-xs text-fg-muted">{linking.hasSelection ? "Link the words you selected to:" : "Add a link to:"}</span>
          <input
            autoFocus
            className="am-linkinput"
            value={linking.url}
            onChange={(e) => setLinking({ ...linking, url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                finishLink();
              }
              if (e.key === "Escape") setLinking(null);
            }}
            aria-label="Web address"
            inputMode="url"
          />
          <button type="button" className="am-tool" onClick={finishLink}>
            Add link
          </button>
          <button type="button" className="am-tool" onClick={() => setLinking(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      <div
        ref={ref}
        role="textbox"
        aria-multiline={!singleLine}
        aria-labelledby={labelId}
        aria-invalid={invalid || undefined}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        data-placeholder={placeholder}
        data-single={singleLine || undefined}
        className="am-input cr-focus mt-2"
        onInput={emit}
        onKeyUp={remember}
        onMouseUp={remember}
        onBlur={remember}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (singleLine) return;
          document.execCommand("insertLineBreak");
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, singleLine ? text.replace(/\s*\n\s*/g, " ") : text);
        }}
        onClick={(e) => {
          // Links open from the preview, not while writing.
          if ((e.target as HTMLElement).closest("a")) e.preventDefault();
        }}
      />
    </div>
  );
}
