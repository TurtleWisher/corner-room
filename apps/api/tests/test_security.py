"""Password hashing and JWT — no database."""

from __future__ import annotations

from uuid import uuid4

import pytest

from cornerroom.infra.errors import UnauthorizedError
from cornerroom.infra.security import create_access_token, decode_access_token, hash_password, verify_password
from cornerroom.infra.settings import Settings
from cornerroom.kernel.money import Money


def test_password_roundtrip() -> None:
    hashed = hash_password("correct horse battery")
    assert hashed != "correct horse battery"
    assert verify_password(hashed, "correct horse battery")
    assert not verify_password(hashed, "wrong")


def test_access_jwt_roundtrip() -> None:
    settings = Settings(jwt_secret="unit-test-secret-must-be-32-bytes!!", jwt_issuer="cornerroom")
    user_id = uuid4()
    session_id = uuid4()
    token, expires = create_access_token(user_id=user_id, settings=settings, session_id=session_id)
    payload = decode_access_token(token, settings)
    assert payload["sub"] == str(user_id)
    assert payload["sid"] == str(session_id)
    assert payload["token_use"] == "access"
    assert expires is not None


def test_access_jwt_rejects_expired() -> None:
    settings = Settings(jwt_secret="unit-test-secret-must-be-32-bytes!!", jwt_issuer="cornerroom")
    from datetime import datetime, timedelta, timezone

    token, _ = create_access_token(
        user_id=uuid4(),
        settings=settings,
        now=datetime.now(timezone.utc) - timedelta(hours=2),
    )
    with pytest.raises(UnauthorizedError):
        decode_access_token(token, settings)


def test_access_jwt_rejects_wrong_secret() -> None:
    settings = Settings(jwt_secret="unit-test-secret-must-be-32-bytes!!", jwt_issuer="cornerroom")
    token, _ = create_access_token(user_id=uuid4(), settings=settings)
    with pytest.raises(UnauthorizedError):
        decode_access_token(
            token,
            Settings(jwt_secret="other-secret-must-be-32-bytes!!!!", jwt_issuer="cornerroom"),
        )


def test_access_jwt_includes_sid() -> None:
    settings = Settings(jwt_secret="unit-test-secret-must-be-32-bytes!!", jwt_issuer="cornerroom")
    sid = uuid4()
    token, _ = create_access_token(user_id=uuid4(), settings=settings, session_id=sid)
    payload = decode_access_token(token, settings)
    assert payload["sid"] == str(sid)
    assert payload["token_use"] == "access"


def test_money_rejects_float() -> None:
    with pytest.raises(TypeError):
        Money(amount_minor=1.5, currency_code="BDT")  # type: ignore[arg-type]
    m = Money(amount_minor=1500, currency_code="bdt")
    assert m.currency_code == "BDT"
    assert m.to_dict()["amount_minor"] == 1500
