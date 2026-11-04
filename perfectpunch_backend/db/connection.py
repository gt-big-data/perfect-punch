import os

import psycopg


class DatabaseConfigurationError(RuntimeError):
    pass


def get_connection():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise DatabaseConfigurationError(
            "DATABASE_URL must be set to connect to Azure Database for PostgreSQL."
        )

    return psycopg.connect(database_url, sslmode="require")
