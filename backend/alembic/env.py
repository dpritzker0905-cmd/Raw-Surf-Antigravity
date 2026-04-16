from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool
import os
from dotenv import load_dotenv
from pathlib import Path

from alembic import context

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / '.env')

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

from models import Base
target_metadata = Base.metadata

db_url = os.environ.get('DATABASE_URL', '')
# Alembic uses psycopg2 (sync). Strip any +asyncpg driver prefix.
sync_url = db_url.replace('postgresql+asyncpg://', 'postgresql://').replace('postgresql+psycopg2://', 'postgresql://')
# Escape % for ConfigParser interpolation (e.g. %23 in URL-encoded passwords)
config.set_main_option('sqlalchemy.url', sync_url.replace('%', '%%'))

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=sync_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    from sqlalchemy import create_engine
    connectable = create_engine(sync_url, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
