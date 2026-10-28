import logging
import os
import secrets
from datetime import date
from pathlib import Path

import mysql.connector
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_bcrypt import Bcrypt
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    get_jwt_identity,
    jwt_required,
)
from mysql.connector import IntegrityError

load_dotenv(Path(__file__).with_name(".env"))

app = Flask(__name__)
configured_jwt_secret = os.getenv("JWT_SECRET_KEY")
app.config["JWT_SECRET_KEY"] = configured_jwt_secret or secrets.token_urlsafe(32)
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = int(os.getenv("JWT_ACCESS_TOKEN_MINUTES", "60")) * 60
logging.basicConfig(level=logging.INFO)
if not configured_jwt_secret:
    app.logger.warning("JWT_SECRET_KEY is unset; issued tokens will be invalidated when the API restarts")
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                origin.strip()
                for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
                if origin.strip()
            ]
        }
    },
)
bcrypt = Bcrypt(app)
jwt = JWTManager(app)

VALID_STATUSES = {"todo", "in_progress", "done"}
VALID_PRIORITIES = {"low", "medium", "high"}
TASK_FIELDS = {
    "title",
    "description",
    "status",
    "priority",
    "assigned_to",
    "due_date",
}
TASK_SELECT = """
    SELECT t.id, t.title, t.description, t.status, t.priority, t.assigned_to,
           t.created_by, t.due_date, t.created_at, t.updated_at,
           assignee.name AS assigned_name, creator.name AS creator_name
    FROM tasks AS t
    LEFT JOIN users AS assignee ON assignee.id = t.assigned_to
    JOIN users AS creator ON creator.id = t.created_by
"""


def get_db_connection():
    return mysql.connector.connect(
        host=os.getenv("MYSQL_HOST", "127.0.0.1"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        user=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD", "root"),
        database=os.getenv("MYSQL_DATABASE", "task_manager"),
    )


def serialize_task(row):
    task = dict(row)
    for field in ("created_at", "updated_at", "due_date"):
        if task[field] is not None:
            task[field] = task[field].isoformat()
    return task


def serialize_user(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
    }


def get_task(cursor, task_id):
    cursor.execute(TASK_SELECT + " WHERE t.id = %s", (task_id,))
    return cursor.fetchone()


def database_error():
    app.logger.exception("Task API database operation failed")
    return jsonify({"error": "Database operation failed. Check the MySQL configuration and try again."}), 503


def current_user_id():
    return int(get_jwt_identity())


@jwt.unauthorized_loader
def missing_token(_reason):
    return jsonify({"error": "Authentication is required"}), 401


@jwt.invalid_token_loader
def invalid_token(_reason):
    return jsonify({"error": "The authentication token is invalid"}), 401


@jwt.expired_token_loader
def expired_token(_jwt_header, _jwt_payload):
    return jsonify({"error": "The authentication token has expired. Please sign in again."}), 401


@app.post("/api/auth/register")
def register():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "A JSON request body is required"}), 400

    name = payload.get("name")
    email = payload.get("email")
    password = payload.get("password")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        return jsonify({"error": "Name is required and must be 100 characters or fewer"}), 400
    if (
        not isinstance(email, str)
        or len(email.strip()) > 100
        or "@" not in email
        or email.strip().startswith("@")
        or email.strip().endswith("@")
        or any(character.isspace() for character in email.strip())
    ):
        return jsonify({"error": "A valid email address is required"}), 400
    if not isinstance(password, str) or not 8 <= len(password.encode("utf-8")) <= 72:
        return jsonify({"error": "Password must be between 8 and 72 bytes"}), 400

    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "INSERT INTO users (name, email, password, role) VALUES (%s, %s, %s, 'member')",
            (name.strip(), email.strip().lower(), bcrypt.generate_password_hash(password).decode("utf-8")),
        )
        connection.commit()
        user_id = cursor.lastrowid
        cursor.execute("SELECT id, name, email, role, created_at FROM users WHERE id = %s", (user_id,))
        user = serialize_user(cursor.fetchone())
        token = create_access_token(identity=str(user_id), additional_claims={"role": "member"})
        return jsonify({"access_token": token, "user": user}), 201
    except IntegrityError:
        if connection is not None:
            connection.rollback()
        return jsonify({"error": "An account with this email already exists"}), 409
    except mysql.connector.Error:
        if connection is not None:
            connection.rollback()
        return database_error()
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


@app.post("/api/auth/login")
def login():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "A JSON request body is required"}), 400
    email = payload.get("email")
    password = payload.get("password")
    if not isinstance(email, str) or not isinstance(password, str):
        return jsonify({"error": "Email and password are required"}), 400

    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, name, email, password, role, created_at FROM users WHERE email = %s",
            (email.strip().lower(),),
        )
        user_row = cursor.fetchone()
        if user_row is None or not bcrypt.check_password_hash(user_row["password"], password):
            return jsonify({"error": "Invalid email or password"}), 401
        user = serialize_user(user_row)
        token = create_access_token(
            identity=str(user["id"]),
            additional_claims={"role": user["role"]},
        )
        return jsonify({"access_token": token, "user": user})
    except mysql.connector.Error:
        return database_error()
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


@app.post("/api/auth/change-password")
@jwt_required()
def change_password():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "A JSON request body is required"}), 400

    current_password = payload.get("current_password")
    new_password = payload.get("new_password")
    if not isinstance(current_password, str) or not isinstance(new_password, str):
        return jsonify({"error": "Current and new passwords are required"}), 400
    if not 8 <= len(new_password.encode("utf-8")) <= 72:
        return jsonify({"error": "New password must be between 8 and 72 bytes"}), 400

    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT password FROM users WHERE id = %s", (current_user_id(),))
        user_row = cursor.fetchone()
        if user_row is None:
            return jsonify({"error": "User not found"}), 404
        if not bcrypt.check_password_hash(user_row["password"], current_password):
            return jsonify({"error": "Current password is incorrect"}), 400
        if bcrypt.check_password_hash(user_row["password"], new_password):
            return jsonify({"error": "Choose a new password different from your current password"}), 400

        password_hash = bcrypt.generate_password_hash(new_password).decode("utf-8")
        cursor.execute("UPDATE users SET password = %s WHERE id = %s", (password_hash, current_user_id()))
        connection.commit()
        return jsonify({"message": "Password changed successfully"})
    except mysql.connector.Error:
        if connection is not None:
            connection.rollback()
        return database_error()
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


@app.get("/api/auth/me")
@jwt_required()
def get_current_user():
    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, name, email, role, created_at FROM users WHERE id = %s",
            (current_user_id(),),
        )
        user = cursor.fetchone()
        if user is None:
            return jsonify({"error": "User not found"}), 404
        return jsonify(serialize_user(user))
    except mysql.connector.Error:
        return database_error()
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


@app.get("/api/users")
@jwt_required()
def get_users():
    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT id, name, email, role, created_at FROM users ORDER BY name")
        return jsonify([serialize_user(row) for row in cursor.fetchall()])
    except mysql.connector.Error:
        return database_error()
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


@app.get("/api/users/<int:user_id>")
@jwt_required()
def get_user(user_id):
    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, name, email, role, created_at FROM users WHERE id = %s",
            (user_id,),
        )
        user = cursor.fetchone()
        if user is None:
            return jsonify({"error": "User not found"}), 404
        return jsonify(serialize_user(user))
    except mysql.connector.Error:
        return database_error()
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


@app.get("/api/dashboard/summary")
@jwt_required()
def get_dashboard_summary():
    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(status = 'todo'), 0) AS todo,
                   COALESCE(SUM(status = 'in_progress'), 0) AS in_progress,
                   COALESCE(SUM(status = 'done'), 0) AS done,
                   COALESCE(SUM(priority = 'high' AND status != 'done'), 0) AS `high_priority`
            FROM tasks
            """
        )
        return jsonify(cursor.fetchone())
    except mysql.connector.Error:
        return database_error()
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


@app.get("/api/tasks")
@jwt_required()
def get_tasks():
    try:
        page = int(request.args.get("page", "1"))
        per_page = int(request.args.get("per_page", "8"))
    except ValueError:
        return jsonify({"error": "Page and per_page must be integers"}), 400
    if page < 1:
        return jsonify({"error": "Page must be at least 1"}), 400
    if not 1 <= per_page <= 50:
        return jsonify({"error": "per_page must be between 1 and 50"}), 400

    status = request.args.get("status", "all")
    if status != "all" and status not in VALID_STATUSES:
        return jsonify({"error": "Invalid task status filter"}), 400
    search = request.args.get("search", "").strip()
    where_parts = []
    params = []
    if status != "all":
        where_parts.append("t.status = %s")
        params.append(status)
    if search:
        where_parts.append("(t.title LIKE %s OR t.description LIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])
    where_clause = " WHERE " + " AND ".join(where_parts) if where_parts else ""

    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT COUNT(*) AS total FROM tasks AS t" + where_clause, params)
        total = cursor.fetchone()["total"]
        cursor.execute(
            TASK_SELECT + where_clause + " ORDER BY t.updated_at DESC, t.id DESC LIMIT %s OFFSET %s",
            params + [per_page, (page - 1) * per_page],
        )
        return jsonify({
            "items": [serialize_task(row) for row in cursor.fetchall()],
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page,
        })
    except mysql.connector.Error:
        return database_error()
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


@app.get("/api/tasks/<int:task_id>")
@jwt_required()
def get_task_detail(task_id):
    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        task = get_task(cursor, task_id)
        if task is None:
            return jsonify({"error": "Task not found"}), 404
        return jsonify(serialize_task(task))
    except mysql.connector.Error:
        return database_error()
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


def validate_task_payload(payload, partial=False):
    if not isinstance(payload, dict):
        return None, (jsonify({"error": "A JSON request body is required"}), 400)

    if not partial or "title" in payload:
        title = payload.get("title")
        if not isinstance(title, str) or not title.strip():
            return None, (jsonify({"error": "Task title is required"}), 400)
        if len(title.strip()) > 150:
            return None, (jsonify({"error": "Task title must be 150 characters or fewer"}), 400)

    updates = {}
    for field in TASK_FIELDS.intersection(payload):
        value = payload[field]
        if field == "title":
            value = value.strip()
        elif field == "status" and (not isinstance(value, str) or value not in VALID_STATUSES):
            return None, (jsonify({"error": "Invalid task status"}), 400)
        elif field == "priority" and (not isinstance(value, str) or value not in VALID_PRIORITIES):
            return None, (jsonify({"error": "Invalid task priority"}), 400)
        elif field == "description" and value is not None and not isinstance(value, str):
            return None, (jsonify({"error": "Task description must be a string"}), 400)
        elif field == "assigned_to" and value is not None:
            if isinstance(value, bool):
                return None, (jsonify({"error": "Assigned user ID must be an integer"}), 400)
            try:
                value = int(value)
            except (TypeError, ValueError):
                return None, (jsonify({"error": "Assigned user ID must be an integer"}), 400)
            if value < 1:
                return None, (jsonify({"error": "Assigned user ID must be positive"}), 400)
        elif field == "due_date" and value:
            try:
                value = date.fromisoformat(value)
            except (TypeError, ValueError):
                return None, (jsonify({"error": "Due date must use YYYY-MM-DD format"}), 400)
        elif field == "due_date":
            value = None
        updates[field] = value
    return updates, None


@app.post("/api/tasks")
@jwt_required()
def create_task():
    updates, error = validate_task_payload(request.get_json(silent=True))
    if error:
        return error

    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        columns = ["title", "description", "status", "priority", "assigned_to", "created_by", "due_date"]
        values = [updates.get("title"), updates.get("description"), updates.get("status", "todo"),
                  updates.get("priority", "medium"), updates.get("assigned_to"),
                  current_user_id(), updates.get("due_date")]
        cursor.execute(
            f"INSERT INTO tasks ({', '.join(columns)}) VALUES ({', '.join(['%s'] * len(columns))})",
            values,
        )
        connection.commit()
        task = get_task(cursor, cursor.lastrowid)
        return jsonify(serialize_task(task)), 201
    except IntegrityError:
        if connection is not None:
            connection.rollback()
        return jsonify({"error": "Assigned user does not exist"}), 400
    except mysql.connector.Error:
        if connection is not None:
            connection.rollback()
        return database_error()
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


@app.put("/api/tasks/<int:task_id>")
@jwt_required()
def update_task(task_id):
    updates, error = validate_task_payload(request.get_json(silent=True), partial=True)
    if error:
        return error
    if not updates:
        return jsonify({"error": "No supported task fields were provided"}), 400

    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        if get_task(cursor, task_id) is None:
            return jsonify({"error": "Task not found"}), 404
        assignments = ", ".join(f"{field} = %s" for field in updates)
        cursor.execute(
            f"UPDATE tasks SET {assignments} WHERE id = %s",
            list(updates.values()) + [task_id],
        )
        connection.commit()
        return jsonify(serialize_task(get_task(cursor, task_id)))
    except IntegrityError:
        if connection is not None:
            connection.rollback()
        return jsonify({"error": "Assigned user does not exist"}), 400
    except mysql.connector.Error:
        if connection is not None:
            connection.rollback()
        return database_error()
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


@app.delete("/api/tasks/<int:task_id>")
@jwt_required()
def delete_task(task_id):
    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
        if cursor.rowcount == 0:
            return jsonify({"error": "Task not found"}), 404
        connection.commit()
        return jsonify({"message": "Task deleted"})
    except mysql.connector.Error:
        if connection is not None:
            connection.rollback()
        return database_error()
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("FLASK_PORT", "5001")))
