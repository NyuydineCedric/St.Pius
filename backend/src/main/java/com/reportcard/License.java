package com.reportcard;

import java.io.File;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Base64;
import java.util.Map;

/**
 * School licensing.
 *
 * A license is an Ed25519-signed token: {@code base64url(payload).base64url(signature)}.
 * Because it is signed rather than merely looked up, the app can verify one
 * with no network at all — which matters when a school's internet is down and
 * the alternative would be locking them out of their own marks.
 *
 * Issued with {@code scripts/license.mjs}. Only the public key is compiled in
 * here; the private key stays with whoever issues licenses.
 *
 * Optionally revalidated against a license server (LICENSE_SERVER_URL) so a
 * key can be revoked mid-term. That check is allowed to fail: an unreachable
 * server falls back to a grace window rather than treating "can't ask" as
 * "not allowed".
 */
final class License {

    /** Public half of the issuing key. Replace before shipping — see README. */
    private static final String LICENSE_PUBLIC_KEY_B64 =
            "MCowBQYDK2VwAyEAtpthR+FTh6ulSE1mhYs4Heyybcf2kQcxqVkS1oP9hwE=";

    /**
     * How long the app keeps trusting a license it cannot revalidate online.
     * Deliberately long: schools go offline for days at a time, and a term's
     * report cards must not depend on connectivity.
     */
    private static final long OFFLINE_GRACE_DAYS = 30;

    enum Status {
        /** Signed, in date, not revoked. Everything works. */
        ACTIVE,
        /** No license supplied at all. */
        MISSING,
        /** Not signed by us, or corrupted in transit. */
        INVALID,
        /** Past its expiry date. */
        EXPIRED,
        /** Explicitly revoked by the license server. */
        REVOKED
    }

    final Status status;
    final String id;
    final String school;
    final String plan;
    final LocalDate expires;
    /** Human-readable explanation, safe to show a school administrator. */
    final String message;

    private License(Status status, String id, String school, String plan, LocalDate expires, String message) {
        this.status = status;
        this.id = id;
        this.school = school;
        this.plan = plan;
        this.expires = expires;
        this.message = message;
    }

    private static License problem(Status status, String message) {
        return new License(status, "", "", "", null, message);
    }

    /**
     * Whether the app should accept changes. Reads stay available in every
     * state on purpose: a school whose license lapsed mid-term must still be
     * able to open and print the report cards it already produced. Losing
     * access to your own records is not a billing prompt, it is a crisis.
     */
    boolean allowsWrites() {
        return status == Status.ACTIVE;
    }

    int daysRemaining() {
        if (expires == null)
            return 0;
        return (int) (expires.toEpochDay() - LocalDate.now().toEpochDay());
    }

    String toJson() {
        return "{\"status\":\"" + status + "\""
                + ",\"school\":\"" + Json.escape(school) + "\""
                + ",\"id\":\"" + Json.escape(id) + "\""
                + ",\"plan\":\"" + Json.escape(plan) + "\""
                + ",\"expires\":\"" + (expires == null ? "" : expires) + "\""
                + ",\"daysRemaining\":" + daysRemaining()
                + ",\"readOnly\":" + !allowsWrites()
                + ",\"message\":\"" + Json.escape(message) + "\"}";
    }

    // ------------------------------------------------------------- loading

    /**
     * Raw token from {@code LICENSE_KEY} or {@code license.key}, or null when
     * neither is set. Throws nothing — unreadable files yield null so the
     * caller can try the shared-store fallback; {@link #load} reports the
     * read error when that fallback is also missing.
     */
    static String readToken(File dataDir) {
        String token = System.getenv("LICENSE_KEY");
        if (token != null && !token.isBlank())
            return token.trim();
        if (dataDir == null)
            return null;
        File file = new File(dataDir, "license.key");
        if (!file.isFile())
            return null;
        try {
            String fromFile = Files.readString(file.toPath(), StandardCharsets.UTF_8).trim();
            return fromFile.isBlank() ? null : fromFile;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Loads from LICENSE_KEY, else {@code license.key} in the data directory,
     * else an optional shared-store fallback (the school-wide key the admin
     * activated). Never throws — a broken license yields an INVALID result so
     * the app can still start and explain itself.
     */
    static License load(File dataDir) {
        return load(dataDir, null);
    }

    static License load(File dataDir, String fallbackToken) {
        String token = readToken(dataDir);
        if ((token == null || token.isBlank()) && dataDir != null) {
            File file = new File(dataDir, "license.key");
            if (file.isFile()) {
                try {
                    Files.readString(file.toPath(), StandardCharsets.UTF_8);
                } catch (Exception e) {
                    // File exists but couldn't be read, and we have nothing
                    // else to try yet — only fail hard if fallback is empty.
                    if (fallbackToken == null || fallbackToken.isBlank())
                        return problem(Status.INVALID, "Could not read license.key: " + e.getMessage());
                }
            }
        }
        if (token == null || token.isBlank()) {
            if (fallbackToken != null && !fallbackToken.isBlank())
                token = fallbackToken.trim();
        }
        if (token == null || token.isBlank())
            return problem(Status.MISSING,
                    "No school licence installed. The school administrator must enter the key supplied with the subscription.");
        return verify(token.trim());
    }

    /** Verifies a token's signature and expiry. Public for the activation endpoint. */
    static License verify(String token) {
        String[] parts = token.split("\\.");
        if (parts.length != 2)
            return problem(Status.INVALID, "That doesn't look like a license key.");

        byte[] payloadBytes;
        byte[] signature;
        try {
            payloadBytes = parts[0].getBytes(StandardCharsets.UTF_8);
            signature = Base64.getUrlDecoder().decode(parts[1]);
        } catch (IllegalArgumentException e) {
            return problem(Status.INVALID, "That license key is malformed.");
        }

        try {
            byte[] spki = Base64.getDecoder().decode(LICENSE_PUBLIC_KEY_B64);
            PublicKey publicKey = KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(spki));
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(publicKey);
            verifier.update(payloadBytes);
            if (!verifier.verify(signature))
                return problem(Status.INVALID, "This license key is not valid for this software.");
        } catch (Exception e) {
            return problem(Status.INVALID, "License check failed: " + e.getMessage());
        }

        Map<String, Object> payload;
        try {
            payload = Json.parseObject(
                    new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return problem(Status.INVALID, "That license key is malformed.");
        }

        String id = Json.getString(payload, "id", "");
        String school = Json.getString(payload, "school", "");
        String plan = Json.getString(payload, "plan", "");

        LocalDate expires;
        try {
            expires = LocalDate.parse(Json.getString(payload, "expires", ""));
        } catch (Exception e) {
            return problem(Status.INVALID, "That license key has no usable expiry date.");
        }

        if (expires.isBefore(LocalDate.now())) {
            return new License(Status.EXPIRED, id, school, plan, expires,
                    "This licence expired on " + expires + ". Existing records can still be viewed and printed, "
                            + "but new changes are blocked until it is renewed.");
        }

        return new License(Status.ACTIVE, id, school, plan, expires,
                "Licensed to " + school + " until " + expires + ".");
    }

    // ------------------------------------------------- optional revocation

    /**
     * Asks the license server whether this key is still good.
     *
     * Returns this license unchanged unless the server explicitly says the key
     * is revoked. A network failure, a timeout, or a 500 all leave the license
     * alone — a school must not be shut out of its own data because a server
     * we run happens to be down.
     *
     * The grace window matters for the opposite case: once we HAVE heard
     * "revoked", that sticks; and if we have not managed to reach the server
     * for {@link #OFFLINE_GRACE_DAYS}, the caller may warn the school.
     */
    License revalidate(File dataDir) {
        String server = System.getenv("LICENSE_SERVER_URL");
        if (server == null || server.isBlank() || status != Status.ACTIVE)
            return this;

        try {
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
            String endpoint = server.replaceAll("/+$", "") + "/api/license/status?id="
                    + URLEncoder.encode(id, StandardCharsets.UTF_8);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(15))
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200)
                return this;

            Map<String, Object> body = Json.parseObject(response.body());
            recordSuccessfulCheck(dataDir);
            if ("revoked".equalsIgnoreCase(Json.getString(body, "status", "")))
                return new License(Status.REVOKED, id, school, plan, expires,
                        "This licence has been revoked. Please contact your supplier.");
            return this;
        } catch (Exception e) {
            // Offline or server down — keep working.
            System.err.println("License revalidation skipped: " + e.getMessage());
            return this;
        }
    }

    /** Days since we last reached the license server, or -1 if never/unknown. */
    static long daysSinceLastCheck(File dataDir) {
        File stamp = new File(dataDir, "license-checked");
        if (!stamp.isFile())
            return -1;
        try {
            long then = Long.parseLong(Files.readString(stamp.toPath()).trim());
            return (System.currentTimeMillis() - then) / 86_400_000L;
        } catch (Exception e) {
            return -1;
        }
    }

    static boolean graceExhausted(File dataDir) {
        long days = daysSinceLastCheck(dataDir);
        return days >= 0 && days > OFFLINE_GRACE_DAYS;
    }

    private void recordSuccessfulCheck(File dataDir) {
        try {
            Files.writeString(new File(dataDir, "license-checked").toPath(),
                    Long.toString(System.currentTimeMillis()));
        } catch (Exception ignored) {
            // Best effort — a missing stamp only affects the warning.
        }
    }
}
