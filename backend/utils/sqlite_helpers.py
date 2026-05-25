import os
import sqlite3
import time
import random
import logging
from functools import wraps

logger = logging.getLogger("utils.sqlite_helpers")

# Portability: Resolve absolute path relative to backend root directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def get_db_path(filename: str) -> str:
    """
    Resolves the absolute database path dynamically relative to the backend directory,
    ensuring full portability across different user profiles and OS environments.
    """
    base_name = os.path.basename(filename)
    return os.path.join(BASE_DIR, base_name)

def get_sqlite_connection(db_path: str, timeout: float = 10.0) -> sqlite3.Connection:
    """
    Establishes an active SQLite connection configured with:
    - Write-Ahead Logging (WAL) mode (allows concurrent reads during writes)
    - Synchronous mode set to NORMAL (optimal speed and safety under WAL)
    - Enhanced page cache size
    """
    conn = sqlite3.connect(db_path, timeout=timeout)
    try:
        # Enable WAL mode - returns "wal" on success
        conn.execute("PRAGMA journal_mode=WAL;")
        # Set synchronous to NORMAL (perfect balance of safety and write speed in WAL)
        conn.execute("PRAGMA synchronous=NORMAL;")
        # Ensure page cache is appropriately sized (2000 pages)
        conn.execute("PRAGMA cache_size=-2000;")
    except sqlite3.OperationalError as e:
        logger.warning(f"Failed to set PRAGMAs on database {db_path}: {e}")
    return conn

def retry_on_lock(max_retries: int = 5, base_delay: float = 0.1):
    """
    Decorator that retries database read/write actions safely using exponential
    backoff and randomized jitter to handle transient SQLite file locks.
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0
            while True:
                try:
                    return func(*args, **kwargs)
                except sqlite3.OperationalError as e:
                    if "locked" in str(e).lower() and retries < max_retries:
                        retries += 1
                        # Backoff with jitter to prevent thundering herd collisions
                        delay = base_delay * (2 ** retries) + random.uniform(0, 0.1)
                        logger.info(f"Database locked, retrying {retries}/{max_retries} in {delay:.2f}s...")
                        time.sleep(delay)
                        continue
                    raise e
        return wrapper
    return decorator
