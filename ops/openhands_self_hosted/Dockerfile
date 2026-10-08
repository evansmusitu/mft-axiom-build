# B1 experimental smoke image only: base digest/transitive dependency lock NOT SEALED.
# The container must not be exposed on the internet or reused as a production executor.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    TMPDIR=/tmp \
    OPENHANDS_DISABLE_TELEMETRY=true

RUN groupadd -g 65532 axiom && \
    useradd --uid 65532 --gid 65532 --home-dir /tmp --no-create-home --shell /usr/sbin/nologin axiom && \
    python -m pip install --disable-pip-version-check --no-cache-dir 'openhands-agent-server==1.51.0' && \
    python -m pip check

COPY --chown=65532:65532 probe.py /opt/axiom/probe.py
WORKDIR /tmp
USER 65532:65532
EXPOSE 18765
CMD ["python", "-m", "openhands.agent_server", "--host", "127.0.0.1", "--port", "18765"]
