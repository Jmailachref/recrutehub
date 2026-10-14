# Built from the repository root so the shared library can be copied in.
FROM python:3.13-slim
WORKDIR /srv
COPY libs/common /libs/common
COPY services/offers/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir /libs/common -r /tmp/requirements.txt
COPY services/offers/ ./
ENV PYTHONUNBUFFERED=1
# Migrations run on every start, then the API.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
