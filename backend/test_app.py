import unittest
from unittest.mock import MagicMock, patch

import mysql.connector

import app
from flask_jwt_extended import create_access_token


class TaskApiValidationTests(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()
        with app.app.app_context():
            token = create_access_token(identity="1")
        self.headers = {"Authorization": f"Bearer {token}"}

    def test_tasks_requires_authentication(self):
        response = self.client.get("/api/tasks")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "Authentication is required")

    def test_registration_rejects_short_password(self):
        response = self.client.post(
            "/api/auth/register",
            json={"name": "New User", "email": "new@example.com", "password": "short"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("8 and 72 bytes", response.get_json()["error"])

    def test_registration_rejects_malformed_email(self):
        response = self.client.post(
            "/api/auth/register",
            json={"name": "New User", "email": "not-an-email", "password": "secure-pass"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "A valid email address is required")

    def test_login_requires_both_credentials(self):
        response = self.client.post("/api/auth/login", json={"email": "person@example.com"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "Email and password are required")

    @patch("app.get_db_connection")
    def test_dashboard_summary_returns_counts(self, connect):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.fetchone.return_value = {
            "total": 3,
            "todo": 1,
            "in_progress": 1,
            "done": 1,
            "high_priority": 1,
        }
        connect.return_value = connection

        response = self.client.get("/api/dashboard/summary", headers=self.headers)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), cursor.fetchone.return_value)
        self.assertIn("AS `high_priority`", cursor.execute.call_args.args[0])

    def test_change_password_requires_authentication(self):
        response = self.client.post(
            "/api/auth/change-password",
            json={"current_password": "current-pass", "new_password": "new-password"},
        )

        self.assertEqual(response.status_code, 401)

    @patch("app.get_db_connection")
    def test_change_password_rejects_incorrect_current_password(self, connect):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.fetchone.return_value = {
            "password": app.bcrypt.generate_password_hash("correct-current").decode("utf-8"),
        }
        connect.return_value = connection

        response = self.client.post(
            "/api/auth/change-password",
            json={"current_password": "wrong-current", "new_password": "new-password"},
            headers=self.headers,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "Current password is incorrect")
        cursor.execute.assert_called_once_with("SELECT password FROM users WHERE id = %s", (1,))
        connection.commit.assert_not_called()

    @patch("app.get_db_connection")
    def test_change_password_updates_hash_after_verifying_current_password(self, connect):
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.fetchone.return_value = {
            "password": app.bcrypt.generate_password_hash("correct-current").decode("utf-8"),
        }
        connect.return_value = connection

        response = self.client.post(
            "/api/auth/change-password",
            json={"current_password": "correct-current", "new_password": "new-password"},
            headers=self.headers,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["message"], "Password changed successfully")
        update_args = cursor.execute.call_args_list[1].args
        self.assertEqual(update_args[0], "UPDATE users SET password = %s WHERE id = %s")
        self.assertTrue(app.bcrypt.check_password_hash(update_args[1][0], "new-password"))
        self.assertEqual(update_args[1][1], 1)
        connection.commit.assert_called_once()

    def test_change_password_rejects_short_new_password(self):
        response = self.client.post(
            "/api/auth/change-password",
            json={"current_password": "correct-current", "new_password": "short"},
            headers=self.headers,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("8 and 72 bytes", response.get_json()["error"])

    @patch("app.get_db_connection")
    def test_create_requires_non_empty_title(self, connect):
        response = self.client.post(
            "/api/tasks",
            json={"title": "  "},
            headers=self.headers,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "Task title is required")
        connect.assert_not_called()

    @patch("app.get_db_connection")
    def test_create_rejects_non_string_status(self, connect):
        response = self.client.post(
            "/api/tasks",
            json={"title": "Prepare report", "status": []},
            headers=self.headers,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "Invalid task status")
        connect.assert_not_called()

    @patch("app.get_db_connection", side_effect=mysql.connector.Error("offline"))
    def test_database_unavailable_is_reported(self, connect):
        response = self.client.get("/api/tasks", headers=self.headers)

        self.assertEqual(response.status_code, 503)
        self.assertIn("Database operation failed", response.get_json()["error"])
        connect.assert_called_once()

    def test_pagination_rejects_non_positive_page(self):
        response = self.client.get("/api/tasks?page=0", headers=self.headers)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "Page must be at least 1")

    def test_pagination_rejects_oversized_page_size(self):
        response = self.client.get("/api/tasks?per_page=1000", headers=self.headers)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "per_page must be between 1 and 50")


if __name__ == "__main__":
    unittest.main()
