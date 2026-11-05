"""Pre-sale campaigns (owner, 2026-11-06, D-PRESALE-04): live numbers per pre-sale that carry on
into the release, counted on the server as running totals with nothing about the visitor kept,
share links with their own counts, and the public pre-sale list for Releases, home and profiles."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.infra.settings import get_settings
from cornerroom.modules.commerce.application.presale_campaigns import PresaleCampaignService, _summary
from cornerroom.modules.commerce.domain import presale_campaign as rules
from cornerroom.modules.commerce.domain.presale_campaign import PresaleCount
from cornerroom.modules.music.domain.models import Release, ReleaseReview
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _buy

BROWSER = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"
NOW = datetime(2026, 11, 6, 12, 0, tzinfo=timezone.utc)


# --- pure rules -------------------------------------------------------------------------------------


def test_referrer_is_the_site_name_only() -> None:
    own = ("cornerroom.live",)
    assert rules.referrer_host("https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.cornerroom.live", own) == "facebook.com"
    assert rules.referrer_host("https://m.facebook.com/story.php?id=1", own) == "facebook.com"
    assert rules.referrer_host("https://www.instagram.com/someone/", own) == "instagram.com"
    assert rules.referrer_host("https://user:pw@t.co:443/abc", own) == "t.co"
    # Corner Room itself, nothing, or junk: no site.
    assert rules.referrer_host("https://www.cornerroom.live/store", own) == ""
    assert rules.referrer_host("https://staging.cornerroom.live/", own) == ""
    assert rules.referrer_host("", own) == ""
    assert rules.referrer_host("javascript:alert(1)", own) == ""
    assert rules.referrer_host("localhost", own) == ""


def test_codes_places_and_bots() -> None:
    code = rules.new_share_code()
    assert len(code) == rules.SHARE_CODE_LENGTH and rules.clean_code(code.upper()) == code
    assert rules.clean_code("../etc") == "" and rules.clean_code(None) == ""
    assert rules.clean_place("store") == "STORE" and rules.clean_place("elsewhere") == ""
    assert rules.looks_like_bot("facebookexternalhit/1.1") and rules.looks_like_bot("Googlebot/2.1") and rules.looks_like_bot(None)
    assert rules.looks_like_bot("WhatsApp/2.23") and rules.looks_like_bot("curl/8.4")
    assert not rules.looks_like_bot(BROWSER)
    assert rules.clean_label("  Instagram   bio ") == "Instagram bio" and rules.clean_label("   ") is None


def test_conversion_is_not_available_without_views() -> None:
    assert rules.conversion_bps(3, 0) is None
    assert rules.conversion_bps(0, 50) == 0
    assert rules.conversion_bps(3, 200) == 150  # 1.5 %


def test_campaign_state() -> None:
    def r(status: str, presale: str | None = None) -> SimpleNamespace:
        return SimpleNamespace(status=status, presale_status=presale)

    assert rules.campaign_state(r("RELEASED"), listed=False, open_now=False, has_price=False, has_orders=True) == "RELEASED"
    assert rules.campaign_state(r("IN_PRODUCTION", "APPROVED"), listed=True, open_now=True, has_price=True, has_orders=False) == "LIVE"
    assert rules.campaign_state(r("QC", "APPROVED"), listed=True, open_now=False, has_price=True, has_orders=True) == "WAITING"
    assert rules.campaign_state(r("IN_PRODUCTION", "REQUESTED"), listed=False, open_now=False, has_price=False, has_orders=False) == "IN_REVIEW"
    assert rules.campaign_state(r("IN_PRODUCTION", "RETURNED"), listed=False, open_now=False, has_price=False, has_orders=False) == "RETURNED"
    assert rules.campaign_state(r("IN_PRODUCTION", "APPROVED"), listed=False, open_now=False, has_price=True, has_orders=False) == "APPROVED"
    assert rules.campaign_state(r("APPROVED"), listed=False, open_now=False, has_price=False, has_orders=True) == "ENDED"
    assert rules.campaign_state(r("IDEA"), listed=False, open_now=False, has_price=False, has_orders=False) == "DRAFT"


def _order(phase: str, *, amount: int = 1000, status: str = "PAID", song: bool = False, user: object = None, refunded: int = 0) -> dict:
    return {
        "order_id": uuid4(), "user_id": user or uuid4(), "status": status, "at": NOW, "phase": phase, "song": song,
        "sold": status in ("PAID", "FULFILLED", "PARTIALLY_REFUNDED", "REFUNDED"),
        "kept": status in ("PAID", "FULFILLED", "PARTIALLY_REFUNDED"),
        "amount_minor": amount, "refunded_minor": refunded, "currency_code": "BDT",
    }


def test_merged_numbers_add_up() -> None:
    """Owner's example: 200 pre-orders, then 30 bought after release, is 230 together; songs bought
    on their own are their own line; ৳0 gifts are buyers, never money."""
    pre = [_order("PRESALE") for _ in range(199)] + [_order("PRESALE", amount=0)]
    after = [_order("RELEASED", amount=3000) for _ in range(30)]
    songs = [_order("RELEASED", amount=500, song=True) for _ in range(4)]
    abandoned = [_order("PRESALE", status="PENDING_PAYMENT")]
    count = SimpleNamespace(phase="PRESALE", kind="VIEW", place="PAGE", link_code="", referrer_host="", hour=NOW, total=1000)
    orders = pre + after + songs + abandoned

    alone = _summary([count], [o for o in orders if o["phase"] == "PRESALE"], {}, True, include_songs=False)
    assert alone["orders"] == 200 and alone["checkout_started"] == 201 and alone["free_copies"] == 1
    assert alone["money"] == [{"currency_code": "BDT", "gross_amount_minor": 199_000, "refunded_amount_minor": 0, "net_amount_minor": 199_000}]
    assert alone["conversion_bps"] == 2000 and "songs" not in alone

    since = _summary([], [o for o in orders if o["phase"] == "RELEASED"], {}, True, include_songs=True)
    assert since["orders"] == 30 and since["songs"]["orders"] == 4 and since["conversion_bps"] is None

    merged = _summary([count], orders, {}, True, include_songs=True)
    assert merged["orders"] == 230 and merged["buyers"] == 230
    assert merged["money"][0]["gross_amount_minor"] == 199_000 + 90_000
    assert merged["songs"]["money"][0]["gross_amount_minor"] == 2000

    hidden = _summary([count], orders, {}, False, include_songs=True)
    assert hidden["money"] is None and hidden["songs"]["money"] is None


# --- with the database ------------------------------------------------------------------------------


async def _live_presale(client: AsyncClient, prefix: str) -> dict:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, f"{prefix}-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name=f"{prefix} Act")
    reviewer = await _staff_with(client, admin, f"{prefix}-reviewer@example.com", "content_manager", label)
    ops = await _staff_with(client, admin, f"{prefix}-ops@example.com", "finance_manager", label)
    created = await client.post(
        "/api/v1/studio/releases", headers=bearer(token),
        json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": f"{prefix} Signal"},
    )
    release_id = created.json()["release"]["id"]
    base = f"/api/v1/studio/releases/{release_id}"
    await client.post(
        f"{base}/price-proposals", headers=bearer(token),
        json={"subject_type": "RELEASE", "subject_id": release_id, "audience": "PRESALE", "amount_minor": 1500},
    )
    when = datetime.now(timezone.utc) + timedelta(days=5)
    assert (await client.post(f"{base}/presale/request", headers=bearer(token), json={"release_at": when.isoformat()})).status_code == 200
    review = f"/api/v1/catalog-intake/releases/{release_id}/presale/review"
    assert (await client.post(review, headers=bearer(reviewer), json={"decision": "approve"})).status_code == 200
    pid = next(p["id"] for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json()
               if p["release_id"] == release_id and p["audience"] == "PRESALE")
    assert (await client.post(f"/api/v1/offer-proposals/{pid}/decision", headers=bearer(ops), json={"decision": "accept"})).status_code == 200
    page = (await client.get(f"/api/v1/presales/releases/{release_id}")).json()
    return {"token": token, "artist_id": artist_id, "release_id": release_id, "reviewer": reviewer, "ops": ops, "page": page}


async def _count(client: AsyncClient, release_id: str, body: dict, *, token: str | None = None, agent: str = BROWSER) -> None:
    headers = {"user-agent": agent, **(bearer(token) if token else {})}
    sent = await client.post(f"/api/v1/presales/releases/{release_id}/count", headers=headers, json=body)
    assert sent.status_code == 204, sent.text


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_campaign_counts_share_links_and_numbers(client: AsyncClient) -> None:
    c = await _live_presale(client, "pcamp")
    token, release_id = c["token"], c["release_id"]
    studio = f"/api/v1/studio/releases/{release_id}"

    # The campaign is in the artist's Pre-sales list, live.
    listed = (await client.get("/api/v1/studio/presales", headers=bearer(token))).json()
    assert [(i["id"], i["state"]) for i in listed["items"]] == [(release_id, "LIVE")]

    # A share link; another account can't see or make one.
    links = await client.post(f"{studio}/share-links", headers=bearer(token), json={"label": "  Instagram   bio "})
    assert links.status_code == 201, links.text
    link = links.json()[0]
    assert link["label"] == "Instagram bio" and link["url"].endswith(f"/releases/{release_id}?from={link['code']}")
    stranger = await register_and_login(client, "pcamp-stranger@example.com")
    assert (await client.get(f"{studio}/share-links", headers=bearer(stranger["access_token"]))).status_code == 404
    assert (await client.get(f"{studio}/numbers", headers=bearer(stranger["access_token"]))).status_code == 404

    # Fans open the page: one through the link from Instagram, one from Facebook, one presses Pre-book in the Store.
    await _count(client, release_id, {"kind": "view", "place": "page", "source": link["code"], "referrer": "https://l.instagram.com/?u=x"})
    await _count(client, release_id, {"kind": "view", "place": "page", "referrer": "https://m.facebook.com/story"})
    await _count(client, release_id, {"kind": "prebook", "place": "store"})
    # Not counted: a link preview robot, the artist themself, staff, a made-up link code.
    await _count(client, release_id, {"kind": "view", "place": "page"}, agent="facebookexternalhit/1.1")
    await _count(client, release_id, {"kind": "view", "place": "page"}, token=token)
    await _count(client, release_id, {"kind": "view", "place": "page"}, token=c["reviewer"])
    await _count(client, release_id, {"kind": "view", "place": "page", "source": "zzzzzzzz"})
    # Something that isn't on pre-sale counts nothing (and still answers 204).
    await _count(client, str(uuid4()), {"kind": "view"})

    fan = await register_and_login(client, "pcamp-fan@example.com")
    receipt = await _buy(client, fan["access_token"], c["page"]["offer"]["id"])
    assert receipt["is_presale"] is True

    numbers = (await client.get(f"{studio}/numbers", headers=bearer(token))).json()
    pre = numbers["presale"]
    assert numbers["since_release"] is None and numbers["money_visible"] is True
    assert pre["views"] == 3 and pre["prebook_clicks"] == 1
    assert pre["orders"] == 1 and pre["buyers"] == 1 and pre["checkout_started"] == 1
    assert pre["money"] == [{"currency_code": "BDT", "gross_amount_minor": 1500, "refunded_amount_minor": 0, "net_amount_minor": 1500}]
    assert pre["conversion_bps"] == 3333
    assert {s["host"]: s["views"] for s in pre["sites"]} == {"instagram.com": 1, "facebook.com": 1, None: 1}
    assert {p["place"]: (p["views"], p["prebook_clicks"]) for p in pre["places"]} == {"PAGE": (3, 0), "STORE": (0, 1)}
    assert pre["links"] == [{"code": link["code"], "label": "Instagram bio", "views": 1, "prebook_clicks": 0}]
    assert sum(d["orders"] for d in pre["timeline"]) == 1
    assert {m["kind"] for m in numbers["milestones"]} >= {"request_presale", "approve_presale", "first_preorder"}
    assert (await client.get(f"{studio}/share-links", headers=bearer(token))).json()[0]["views"] == 1

    # Catalog staff see the counts, not the money (as Studio Sales).
    staff_view = (await client.get(f"{studio}/numbers", headers=bearer(c["reviewer"]))).json()
    assert staff_view["money_visible"] is False and staff_view["presale"]["money"] is None and staff_view["presale"]["orders"] == 1

    # Public list for Releases and the artist's profile; never the songs.
    everyone = (await client.get("/api/v1/presales/releases")).json()["items"]
    assert release_id in [i["id"] for i in everyone]
    mine = (await client.get(f"/api/v1/presales/releases?artist_id={c['artist_id']}")).json()["items"]
    assert [i["id"] for i in mine] == [release_id] and "tracks" not in mine[0]

    # A link put away keeps its history and still counts visits from where it was posted.
    archived = await client.post(f"{studio}/share-links/{link['id']}/archive", headers=bearer(token))
    assert archived.status_code == 200 and archived.json()[0]["archived"] is True
    await _count(client, release_id, {"kind": "view", "source": link["code"]})
    assert (await client.get(f"{studio}/share-links", headers=bearer(token))).json()[0]["views"] == 2

    # Release day: the campaign moves to the release; visits now count as "since release".
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        await session.execute(update(Release).where(Release.id == release_id).values(status="RELEASED"))
        session.add(ReleaseReview(release_id=release_id, reviewer_id=uuid4(), action="release", from_status="SCHEDULED", to_status="RELEASED"))
        await session.commit()
    await _count(client, release_id, {"kind": "view", "place": "page"})
    after = (await client.get(f"{studio}/numbers", headers=bearer(token))).json()
    assert after["released_at"] is not None and after["had_presale"] is True
    assert after["presale"]["views"] == 4 and after["since_release"]["views"] == 1 and after["all"]["views"] == 5
    assert after["presale"]["orders"] == 1 and after["since_release"]["orders"] == 0 and after["all"]["orders"] == 1
    listed = (await client.get("/api/v1/studio/presales", headers=bearer(token))).json()
    assert listed["items"][0]["state"] == "RELEASED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_one_address_is_capped(client: AsyncClient) -> None:
    """D-PRESALE-04: one internet address counts at most N times per release per hour."""
    c = await _live_presale(client, "pcap")
    settings = get_settings().model_copy(update={"presale_count_max_per_hour": 2})
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        svc = PresaleCampaignService(session, settings)
        counted = [
            await svc.count(c["release_id"], kind="VIEW", user_agent=BROWSER, address="203.0.113.7") for _ in range(4)
        ]
        other = await svc.count(c["release_id"], kind="VIEW", user_agent=BROWSER, address="203.0.113.8")
        await session.commit()
        total = sum((await session.execute(select(PresaleCount.total).where(PresaleCount.release_id == c["release_id"]))).scalars())
    assert counted == [True, True, False, False] and other is True and total == 3
