from dotenv import load_dotenv

from perfectpunch_backend.db.connection import get_connection

load_dotenv()

data = {
    "punch_type": "jab",
    "punch_hand": "left",
    "impact_force": 325.5,
    "punch_velocity": 13.8,
}

with get_connection() as connection:
    row = connection.execute(
        """
        INSERT INTO punches (punch_type, punch_hand, impact_force, punch_velocity)
        VALUES (%s, %s, %s, %s)
        RETURNING id
        """,
        (
            data["punch_type"],
            data["punch_hand"],
            data["impact_force"],
            data["punch_velocity"],
        ),
    ).fetchone()

print("Data sent:", row[0])
