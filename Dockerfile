FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY backend/src/main/java ./src
RUN javac -d out $(find src -name "*.java")
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p lib \
    && curl -fsSL -o lib/postgresql.jar https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.5/postgresql-42.7.5.jar

FROM eclipse-temurin:21-jre
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app \
    && mkdir -p /app/data /app/public \
    && chown -R app:app /app

COPY --from=build --chown=app:app /app/out .
COPY --from=build --chown=app:app /app/lib ./lib

ENV BIND_HOST=0.0.0.0
ENV PORT=8080
ENV DATA_DIR=/app/data

USER app
EXPOSE 8080
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

# args: dataDir, staticDir — see Main.java
ENTRYPOINT ["java", "-cp", ".:lib/postgresql.jar", "com.reportcard.Main"]
CMD ["/app/data", "/app/public"]
