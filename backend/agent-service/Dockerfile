# Build from the repository root:
#   docker build -f backend/agent-service/Dockerfile -t triplanner/agent .
FROM python:3.12-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY backend/agent-service/pyproject.toml backend/agent-service/uv.lock backend/agent-service/README.md ./
COPY backend/agent-service/src ./src
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1

RUN mkdir -p /app/.data && chown -R app:app /app
USER app
EXPOSE 4100

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=12 \
  CMD curl -f http://localhost:4100/health || exit 1

CMD ["uvicorn", "tripsuggest.main:app", "--host", "0.0.0.0", "--port", "4100"]
