"""How an act's email is written out for one person (owner, 2026-11-02, D-MAIL-01 and D-MAIL-02).

Artists write plain text with two extras:

- **Fill-ins** for what differs per person: {buyer_name}, {first_name}, {music} (what this person
  bought of the chosen music) and {artist}. Studio shows them as the real words.
- **Links inside the text**, written ``[words people see](https://address)``.

Each email goes out as HTML (the music's cover, the message, a Listen button and any files) with a
plain-text copy. Every link passes through Corner Room's click link so the act's report can count
clicks (owner chose click counting, no open tracking); the stop link and the purchases link don't.
Pure functions only: the service decides who gets what.
"""

from __future__ import annotations

import html
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

FILL_INS = ("buyer_name", "first_name", "music", "artist")
# Said in place of a buyer's name when Corner Room doesn't have one.
NO_NAME = "friend"
SUBJECT_MAX = 200

_TOKEN = re.compile(
    r"\[([^\]\n]{1,300})\]\((https?://[^\s()<>\"']{1,2000})\)|\{(" + "|".join(FILL_INS) + r")\}"
)
_FILL_IN = re.compile(r"\{(" + "|".join(FILL_INS) + r")\}")

# The email's colours: the Music world (Sky, Indigo, Ice) on light paper, so every mail app shows
# it the same way. Small Indigo text sits on white, never on Sky (brand contrast table).
PAPER = "#f2f0f9"
CARD = "#ffffff"
NIGHT = "#120f26"
INK = "#1b1838"
MUTED = "#5d5a7e"
INDIGO_INK = "#2e2860"
SKY = "#53c8ea"
ICE = "#bbedfe"
CREAM = "#f6ece6"
FONT = "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"


def music_line(titles: list[str]) -> str:
    titles = [t for t in titles if t]
    if not titles:
        return "your music"
    if len(titles) == 1:
        return titles[0]
    if len(titles) <= 3:
        return ", ".join(titles[:-1]) + " and " + titles[-1]
    return ", ".join(titles[:3]) + f" and {len(titles) - 3} more"


def first_name(name: str | None) -> str:
    words = (name or "").split()
    return words[0] if words else NO_NAME


def values_for(name: str | None, titles: list[str], artist: str) -> dict[str, str]:
    clean = (name or "").strip()
    return {"buyer_name": clean or NO_NAME, "first_name": first_name(clean), "music": music_line(titles), "artist": artist}


def fill(text: str, values: dict[str, str]) -> str:
    """Fill-ins replaced; anything else in braces is left as written."""
    return _FILL_IN.sub(lambda m: values.get(m.group(1), m.group(0)), text)


def parse(text: str) -> list[tuple[str, ...]]:
    """("text", words) | ("fill", key) | ("link", label, url), in order."""
    out: list[tuple[str, ...]] = []
    pos = 0
    for m in _TOKEN.finditer(text):
        if m.start() > pos:
            out.append(("text", text[pos : m.start()]))
        if m.group(3):
            out.append(("fill", m.group(3)))
        else:
            out.append(("link", m.group(1), m.group(2)))
        pos = m.end()
    if pos < len(text):
        out.append(("text", text[pos:]))
    return out


def link_addresses(text: str) -> list[str]:
    return [t[2] for t in parse(text) if t[0] == "link"]


def subject_line(subject: str, values: dict[str, str]) -> str:
    """A subject has no links: a written link keeps only its words."""
    words = "".join(fill(t[1], values) if t[0] == "text" else values.get(t[1], "") if t[0] == "fill" else fill(t[1], values) for t in parse(subject))
    return " ".join(words.split())[:SUBJECT_MAX]


@dataclass
class Links:
    """The links one email carries, in order; each is opened through ``click_url(position)``."""

    click_url: Callable[[int], str]
    items: list[dict[str, Any]] = field(default_factory=list)

    def add(self, url: str, label: str, kind: str, **extra: Any) -> str:
        self.items.append({"url": url, "label": label[:300], "kind": kind, **extra})
        return self.click_url(len(self.items) - 1)


def body_text(body: str, values: dict[str, str], links: Links) -> str:
    parts: list[str] = []
    for token in parse(body):
        if token[0] == "text":
            parts.append(fill(token[1], values))
        elif token[0] == "fill":
            parts.append(values.get(token[1], ""))
        else:
            label = fill(token[1], values)
            parts.append(f"{label} ({links.add(token[2], label, 'LINK')})")
    return "".join(parts).strip()


def body_html(body: str, values: dict[str, str], links: Links) -> str:
    parts: list[str] = []
    for token in parse(body):
        if token[0] == "text":
            parts.append(html.escape(fill(token[1], values)))
        elif token[0] == "fill":
            parts.append(html.escape(values.get(token[1], "")))
        else:
            label = fill(token[1], values)
            href = links.add(token[2], label, "LINK")
            parts.append(
                f'<a href="{html.escape(href)}" style="color:{INDIGO_INK};text-decoration:underline;font-weight:600">'
                f"{html.escape(label)}</a>"
            )
    joined = "".join(parts).strip().replace("\r\n", "\n")
    paragraphs = [p.strip("\n") for p in re.split(r"\n{2,}", joined) if p.strip()]
    return "".join(
        f'<p style="margin:0 0 18px;font-family:{FONT};font-size:16px;line-height:1.65;color:{INK}">'
        + p.replace("\n", "<br>")
        + "</p>"
        for p in paragraphs
    )


@dataclass
class Written:
    subject: str
    text: str
    html: str
    links: list[dict[str, Any]]


def write_email(
    *,
    kind: str,
    subject: str,
    body: str,
    values: dict[str, str],
    click_url: Callable[[int], str],
    web_base_url: str,
    cover_url: str | None = None,
    listen: tuple[str, str] | None = None,
    files: list[dict[str, Any]] | None = None,
    stop_url: str | None = None,
    note: str | None = None,
    claim: tuple[str, str] | None = None,
) -> Written:
    """One person's email. ``listen`` is (page address, title); ``files`` are {"id", "name", "kind"}.
    A thank-you (kind THANK_YOU) has no stop link: it always sends, as part of the purchase.

    A music gift (kind GIFT, D-GIFT-MUSIC-01) may carry the act's own ``note`` for this person and,
    for an address with no account yet, ``claim`` = (sign-up address, the email to sign up with)
    in place of the Listen button."""
    artist = values["artist"]
    web = web_base_url.rstrip("/")
    subject_out = subject_line(subject, values)
    # Both copies number the written links the same way, from 0, so one list serves both.
    links = Links(click_url)
    if note and note.strip():
        # Written by the act for this one person; fill-ins and links work as in the body.
        body = body.rstrip() + "\n\n" + note.strip()
    html_body = body_html(body, values, links)
    text_body = body_text(body, values, Links(click_url))

    text_lines = [text_body, ""]
    html_extra: list[str] = []
    if claim is not None:
        href = links.add(claim[0], "Create your free account", "LISTEN")
        line = f"Your music is waiting for {claim[1]}. Create your free Corner Room account with this email address and it is yours."
        text_lines.append(f"{line} {href}")
        html_extra.append(
            f'<p style="margin:0 0 12px;font-family:{FONT};font-size:15px;line-height:1.6;color:{INK}">{html.escape(line)}</p>'
            '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr>'
            f'<td style="background:{SKY}">'
            f'<a href="{html.escape(href)}" style="display:inline-block;padding:14px 22px;font-family:{FONT};font-size:15px;'
            f'font-weight:700;color:{INDIGO_INK};text-decoration:none">Create your free account</a>'
            "</td></tr></table>"
        )
    elif listen is not None:
        href = links.add(listen[0], f"Listen to {listen[1]}", "LISTEN")
        text_lines.append(f"Listen to {listen[1]} on Corner Room: {href}")
        html_extra.append(
            '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr>'
            f'<td style="background:{SKY}">'
            f'<a href="{html.escape(href)}" style="display:inline-block;padding:14px 22px;font-family:{FONT};font-size:15px;'
            f'font-weight:700;color:{INDIGO_INK};text-decoration:none">Listen to {html.escape(listen[1])} on Corner Room</a>'
            "</td></tr></table>"
        )
    if files:
        text_lines.append("")
        text_lines.append(f"From {artist}, for you:")
        items_html = []
        for f in files:
            verb = "Download" if f.get("kind") == "FILE" else "Open"
            href = links.add(f.get("url") or "", f"{verb} {f['name']}", "FILE", file_id=str(f["id"]))
            text_lines.append(f"- {verb} {f['name']}: {href}")
            items_html.append(
                f'<li style="margin:0 0 8px"><a href="{html.escape(href)}" style="color:{INDIGO_INK};font-weight:600;'
                f'text-decoration:underline">{verb} {html.escape(f["name"])}</a></li>'
            )
        html_extra.append(
            f'<div style="margin:4px 0 24px;padding:16px 18px;background:{PAPER};border-left:3px solid {SKY}">'
            f'<p style="margin:0 0 10px;font-family:{FONT};font-size:13px;font-weight:700;letter-spacing:.08em;'
            f'text-transform:uppercase;color:{MUTED}">From {html.escape(artist)}, for you</p>'
            f'<ul style="margin:0;padding-left:18px;font-family:{FONT};font-size:15px;line-height:1.5;color:{INK}">'
            + "".join(items_html)
            + "</ul></div>"
        )

    if kind == "THANK_YOU":
        footer = [
            f"Sent by Corner Room for {artist}. Replies to this email aren't read.",
            ("Your music on Corner Room", f"{web}/purchases"),
        ]
    elif kind == "GIFT":
        footer = [
            f"You're getting this because {artist} gave you music on Corner Room. Replies to this email aren't read.",
            (f"Stop emails from {artist}", stop_url or f"{web}/account"),
        ]
    elif kind == "GIFT_UPDATE":
        # A collectible status email (D-CAMPAIGN-05): about a gift the buyer is owed, so no stop link.
        footer = [
            f"You're getting this because you're getting a gift from {artist} for music you bought on Corner Room. "
            "Replies to this email aren't read.",
            ("Your music on Corner Room", f"{web}/purchases"),
        ]
    else:
        footer = [
            f"You're getting this because you bought music from {artist} on Corner Room. Replies to this email aren't read.",
            (f"Stop emails from {artist}", stop_url or f"{web}/account"),
        ]
    text_lines += ["", "--"]
    footer_html = []
    for line in footer:
        if isinstance(line, tuple):
            text_lines.append(f"{line[0]}: {line[1]}")
            footer_html.append(f'<a href="{html.escape(line[1])}" style="color:{MUTED};text-decoration:underline">{html.escape(line[0])}</a>')
        else:
            text_lines.append(line)
            footer_html.append(html.escape(line))

    preheader = html.escape(" ".join(text_body.split())[:140])
    cover_html = (
        f'<tr><td style="padding:0"><img src="{html.escape(cover_url)}" width="560" alt="" '
        f'style="display:block;width:100%;max-width:560px;height:auto;border:0"></td></tr>'
        if cover_url
        else ""
    )
    document = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{html.escape(subject_out)}</title></head>"
        f'<body style="margin:0;padding:0;background:{PAPER}">'
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0">{preheader}</div>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAPER}"><tr>'
        '<td align="center" style="padding:24px 12px">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:{CARD}">'
        f'<tr><td style="background:{NIGHT};padding:18px 28px">'
        f'<span style="font-family:{FONT};font-size:16px;font-weight:800;color:{CREAM}">{html.escape(artist)}</span>'
        f'<span style="font-family:{FONT};font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;'
        f'color:{ICE}">&nbsp;&nbsp;via Corner Room</span></td></tr>'
        f"{cover_html}"
        f'<tr><td style="padding:30px 28px 8px">{html_body}{"".join(html_extra)}</td></tr>'
        f'<tr><td style="padding:18px 28px 26px;border-top:1px solid #e4e1f0;font-family:{FONT};font-size:12px;'
        f'line-height:1.6;color:{MUTED}">{"<br>".join(footer_html)}</td></tr>'
        "</table></td></tr></table></body></html>"
    )
    return Written(subject=subject_out, text="\n".join(text_lines).strip() + "\n", html=document, links=links.items)
