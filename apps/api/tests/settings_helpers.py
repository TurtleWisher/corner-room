"""Shared test settings. Production now requires dedicated signing secrets and named hosts (Gate 4)."""

PROD_HARDENING = dict(
    ticket_signing_secret="test-only-ticket-signing-secret-0123456789",
    media_token_secret="test-only-media-token-signing-secret-0123456789",
    allowed_hosts=["api.cornerroom.example"],
)
