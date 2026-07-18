FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY backend/src/main/java ./src
RUN javac -d out $(find src -name "*.java")

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/out .
EXPOSE 8080
ENTRYPOINT ["java", "com.reportcard.Main"]