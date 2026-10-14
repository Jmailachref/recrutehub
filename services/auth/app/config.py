import os

ACCESS_TTL_SECONDS = int(os.environ.get("ACCESS_TTL_SECONDS", 15 * 60))
REFRESH_TTL_SECONDS = int(os.environ.get("REFRESH_TTL_SECONDS", 14 * 24 * 3600))
CANDIDATE_TTL_SECONDS = 7 * 24 * 3600
SERVICE_TTL_SECONDS = 5 * 60
# Secure cookies need HTTPS; turn on in production.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
# Other services exchange this secret for a short-lived service token.
SERVICE_SECRET = os.environ.get("SERVICE_SECRET", "")
PRIVATE_KEY_FILE = os.environ.get("AUTH_PRIVATE_KEY_FILE", "/keys/private.pem")
LOGIN_MAX_FAILURES = 10
LOGIN_WINDOW_SECONDS = 15 * 60
