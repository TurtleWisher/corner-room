"""A fan gift's email, written out (owner, 2026-11-20, D-GIFT-FAN-01, D-GIFT-FAN-02).

One pure function writes the real email, the giver's preview and the staff preview, so what the
giver designs is exactly what each person gets. The giver's words use the artist-email syntax
(`{first_name}`, `{music}` fill-ins and `[words](https://...)` links). Files are passed in with the
address each copy uses: the person's own gift link in the real email, a `cid:` placeholder in
previews (the page swaps in the picture it fetched itself)."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Any

from cornerroom.modules.commerce.application.artist_mail_render import first_name, parse

FONT = "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"

# Three looks a giver chooses from, in Corner Room's own colours (brand: Sky, Ember, Night).
LOOK_COLOURS: dict[str, dict[str, str]] = {
    "SKY": {"page": "#eaf7fc", "card": "#ffffff", "band": "#120f26", "band_ink": "#bbedfe", "accent": "#53c8ea",
            "button_ink": "#2e2860", "ink": "#1b1838", "muted": "#5d5a7e", "quote": "#f2f0f9"},
    "EMBER": {"page": "#fbefe7", "card": "#fffaf6", "band": "#2a1410", "band_ink": "#ffd2b8", "accent": "#ff8a4c",
              "button_ink": "#2a1410", "ink": "#2a1a16", "muted": "#7a5d52", "quote": "#fdeee4"},
    "NIGHT": {"page": "#0b0a18", "card": "#17142e", "band": "#05040d", "band_ink": "#bbedfe", "accent": "#53c8ea",
              "button_ink": "#120f26", "ink": "#f6ece6", "muted": "#b7b3d6", "quote": "#221e40"},
}


@dataclass
class GiftEmail:
    subject: str
    text: str
    html: str


def default_subject(who: str, title: str, act: str) -> str:
    return f"{who} sent you {title} by {act}"


def fill_values(*, person_name: str | None, title: str) -> dict[str, str]:
    """`{first_name}` is the person's first name as the giver typed it, else "there"."""
    return {"first_name": first_name(person_name) if (person_name or "").split() else "there", "music": title}


def _fill(text: str, values: dict[str, str]) -> str:
    return re.sub(r"\{([a-z_]+)\}", lambda m: values.get(m.group(1), m.group(0)), text)


def _message_html(message: str, values: dict[str, str], c: dict[str, str]) -> str:
    parts: list[str] = []
    for token in parse(message):
        if token[0] == "text":
            parts.append(html.escape(_fill(token[1], values)))
        elif token[0] == "fill":
            parts.append(html.escape(values.get(token[1], "")))
        else:
            label = _fill(token[1], values)
            parts.append(
                f'<a href="{html.escape(token[2])}" style="color:{c["accent"]};text-decoration:underline;font-weight:600">'
                f"{html.escape(label)}</a>"
            )
    joined = "".join(parts).strip()
    paragraphs = [p.strip("\n") for p in re.split(r"\n{2,}", joined) if p.strip()]
    return "".join(
        f'<p style="margin:0 0 14px;font-family:{FONT};font-size:17px;line-height:1.65;color:{c["ink"]}">'
        + p.replace("\n", "<br>") + "</p>"
        for p in paragraphs
    )


def _message_text(message: str, values: dict[str, str]) -> str:
    out: list[str] = []
    for token in parse(message):
        if token[0] == "text":
            out.append(_fill(token[1], values))
        elif token[0] == "fill":
            out.append(values.get(token[1], ""))
        else:
            out.append(f"{_fill(token[1], values)} ({token[2]})")
    return "".join(out).strip()


def _button(label: str, href: str, c: dict[str, str]) -> str:
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr>'
        f'<td style="background:{c["accent"]}">'
        f'<a href="{html.escape(href)}" style="display:inline-block;padding:14px 22px;font-family:{FONT};font-size:15px;'
        f'font-weight:700;color:{c["button_ink"]};text-decoration:none">{html.escape(label)}</a></td></tr></table>'
    )


def write_gift_email(
    *,
    look: str,
    giver: str | None,
    passed_by: str | None,
    title: str,
    act: str,
    person_name: str | None,
    subject: str | None,
    message: str | None,
    status: str,
    link: str,
    claim_days: int,
    preorder: bool = False,
    cover_url: str | None = None,
    files: list[dict[str, Any]] | None = None,
) -> GiftEmail:
    """One person's gift email. ``files`` are {"name", "kind" IMAGE|PDF, "url"}. ``message`` and
    ``subject`` are None when the giver wrote none, or when staff sent the gift without them."""
    c = LOOK_COLOURS.get(look, LOOK_COLOURS["SKY"])
    who = giver or "Someone"
    values = fill_values(person_name=person_name, title=title)
    subject_out = " ".join(_fill(subject, values).split()) if subject else default_subject(who, title, act)
    lead = (
        f"{passed_by} passed on a gift to you: {title} by {act}, first given by {who}."
        if passed_by
        else f"{who} bought {title} by {act} on Corner Room as a gift for you."
    )
    if status == "GIVEN" and preorder:
        next_step, button = "It's a pre-order: it's yours now and unlocks in your library the day it comes out.", "See your gift"
    elif status == "GIVEN":
        next_step, button = "It's in your library now.", "Open your gift and listen"
    elif status == "CHOOSING":
        next_step, button = "Open your gift to see what you can do with it.", "Open your gift"
    else:
        wait = f" The gift waits {claim_days} days." if claim_days > 0 else ""
        next_step, button = f"Create your free Corner Room account with this email address to get it.{wait}", "Open your gift"

    text_lines = [lead, ""]
    blocks: list[str] = [
        f'<p style="margin:0 0 18px;font-family:{FONT};font-size:15px;line-height:1.6;color:{c["muted"]}">{html.escape(lead)}</p>'
    ]
    if message and message.strip():
        text_lines += [f"{who} wrote:", _message_text(message, values), ""]
        blocks.append(
            f'<div style="margin:0 0 22px;padding:18px 20px;background:{c["quote"]};border-left:3px solid {c["accent"]}">'
            f'<p style="margin:0 0 10px;font-family:{FONT};font-size:12px;font-weight:700;letter-spacing:.1em;'
            f'text-transform:uppercase;color:{c["muted"]}">From {html.escape(who)}</p>'
            f"{_message_html(message, values, c)}</div>"
        )
    images = [f for f in files or [] if f.get("kind") == "IMAGE"]
    pdfs = [f for f in files or [] if f.get("kind") == "PDF"]
    for f in images:
        blocks.append(
            f'<img src="{html.escape(f["url"])}" alt="{html.escape(f["name"])}" width="504" '
            'style="display:block;width:100%;max-width:504px;height:auto;border:0;margin:0 0 18px">'
        )
        text_lines.append(f"Picture: {f['name']} ({f['url']})")
    if pdfs:
        items = "".join(
            f'<li style="margin:0 0 8px"><a href="{html.escape(f["url"])}" style="color:{c["accent"]};font-weight:600;'
            f'text-decoration:underline">Download {html.escape(f["name"])}</a></li>'
            for f in pdfs
        )
        blocks.append(
            f'<ul style="margin:0 0 22px;padding-left:18px;font-family:{FONT};font-size:15px;line-height:1.5;color:{c["ink"]}">{items}</ul>'
        )
        text_lines += [f"Download {f['name']}: {f['url']}" for f in pdfs]
    if images or pdfs:
        text_lines.append("")
    blocks.append(f'<p style="margin:0 0 12px;font-family:{FONT};font-size:15px;line-height:1.6;color:{c["ink"]}">{html.escape(next_step)}</p>')
    blocks.append(_button(button, link, c))
    text_lines += [next_step, link, "", "--", "You got this email because someone typed your address into a gift on Corner Room."]

    cover_html = (
        f'<tr><td style="padding:0"><img src="{html.escape(cover_url)}" width="560" alt="" '
        'style="display:block;width:100%;max-width:560px;height:auto;border:0"></td></tr>'
        if cover_url
        else ""
    )
    document = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{html.escape(subject_out)}</title></head>"
        f'<body style="margin:0;padding:0;background:{c["page"]}">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{c["page"]}"><tr>'
        '<td align="center" style="padding:24px 12px">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:{c["card"]}">'
        f'<tr><td style="background:{c["band"]};padding:18px 28px">'
        f'<span style="font-family:{FONT};font-size:16px;font-weight:800;color:{c["band_ink"]}">A gift for you</span>'
        f'<span style="font-family:{FONT};font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;'
        f'color:{c["band_ink"]}">&nbsp;&nbsp;via Corner Room</span></td></tr>'
        f"{cover_html}"
        f'<tr><td style="padding:28px 28px 8px">{"".join(blocks)}</td></tr>'
        f'<tr><td style="padding:16px 28px 24px;border-top:1px solid {c["quote"]};font-family:{FONT};font-size:12px;'
        f'line-height:1.6;color:{c["muted"]}">You got this email because someone typed your address into a gift on Corner Room. '
        "Replies to this email aren't read.</td></tr>"
        "</table></td></tr></table></body></html>"
    )
    return GiftEmail(subject=subject_out, text="\n".join(text_lines).strip() + "\n", html=document)
