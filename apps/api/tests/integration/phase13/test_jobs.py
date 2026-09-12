"""Background jobs exist on the existing arq worker. No new broker."""

from cornerroom.worker import (
    WorkerSettings,
    aggregate_daily_metrics,
    process_notification_delivery,
    rebuild_search_index,
)


def test_phase13_jobs_registered_on_existing_worker() -> None:
    assert process_notification_delivery in WorkerSettings.functions
    assert rebuild_search_index in WorkerSettings.functions
    assert aggregate_daily_metrics in WorkerSettings.functions
    names = {fn.__name__ for fn in WorkerSettings.functions}
    assert "drain_outbox" in names
