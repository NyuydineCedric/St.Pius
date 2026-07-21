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
COPY --from=build /app/out .
COPY --from=build /app/lib ./lib
EXPOSE 8080
ENTRYPOINT ["java", "-cp", ".:lib/postgresql.jar", "com.reportcard.Main"]