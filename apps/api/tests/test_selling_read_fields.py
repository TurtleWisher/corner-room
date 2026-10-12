"""Read fields the customer buying flow needs (OD-27, OD-29). Additive only."""

from types import SimpleNamespace
from uuid import uuid4

from cornerroom.api.v1.commerce import _offer_out
from cornerroom.api.v1.ticketing import TicketOut


def test_public_offer_names_what_it_sells() -> None:
    subject = uuid4()
    offer = SimpleNamespace(id=uuid4(), organization_id=uuid4(), product_id=uuid4(), amount_minor=5000,
                            currency_code="BDT", status="ACTIVE", version=3)
    product = SimpleNamespace(product_type="TRACK", name="Low Tide", subject_id=subject)
    out = _offer_out(offer, product, staff=False)
    assert out.subject_id == subject
    assert out.version is None  # staff-only field stays hidden


def test_offer_without_product_has_no_subject() -> None:
    offer = SimpleNamespace(id=uuid4(), organization_id=uuid4(), product_id=uuid4(), amount_minor=1,
                            currency_code="BDT", status="ACTIVE", version=1)
    assert _offer_out(offer, None, staff=False).subject_id is None


def test_ticket_out_carries_owner_event_fields() -> None:
    fields = TicketOut.model_fields
    assert "event_id" in fields and "ticket_type_name" in fields
    assert fields["event_id"].default is None
