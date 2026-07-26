"""Fail fast when any SQLAlchemy relationship cannot be configured."""


def test_all_orm_mappers_configure():
    """Importing the complete model registry must configure every relationship."""
    import models  # noqa: F401  - imports the complete project model registry
    from sqlalchemy.orm import configure_mappers

    configure_mappers()
