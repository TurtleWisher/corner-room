"""The request database session commits before the response is sent.

With FastAPI's default dependency scope, the commit in get_session ran after the response, so a
client's next request could miss a row it was just told about (a refreshed session, a new order).
"""

from fastapi.params import Depends as DependsParam

from cornerroom.api import deps


def test_db_session_dependency_commits_before_the_response() -> None:
    default = deps.db_session.__defaults__[0]
    assert isinstance(default, DependsParam)
    assert default.scope == "function"
