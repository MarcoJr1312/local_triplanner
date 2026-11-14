# Build from the repository root:
#   docker build -f local/agent-service/Dockerfile -t triplanner/agent .
FROM python:3.12-slim

# curl is required by the container health check.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY local/agent-service/pyproject.toml local/agent-service/uv.lock local/agent-service/README.md ./
COPY local/agent-service/src ./src
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 4100

CMD ["uvicorn", "tripsuggest.main:app", "--host", "0.0.0.0", "--port", "4100"]
