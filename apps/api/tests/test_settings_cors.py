"""CORS origins accept the .env.example comma form and the Compose JSON form."""

from cornerroom.infra.settings import Settings


def _origins(monkeypatch, raw: str) -> list[str]:
    monkeypatch.setenv("CORS_ORIGINS", raw)
    return Settings(_env_file=None).cors_origins


def test_comma_separated_origins(monkeypatch) -> None:
    assert _origins(monkeypatch, "http://localhost:3000") == ["http://localhost:3000"]
    assert _origins(monkeypatch, "http://a.test, http://b.test") == ["http://a.test", "http://b.test"]


def test_json_list_origins(monkeypatch) -> None:
    assert _origins(monkeypatch, '["http://localhost:3000"]') == ["http://localhost:3000"]
