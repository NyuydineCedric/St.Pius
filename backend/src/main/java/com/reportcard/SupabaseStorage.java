package com.reportcard;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;

/**
 * Supabase Storage client for images.
 *
 * Student photos used to live in the database as base64 data URLs on the
 * student row — ~40–80KB each, which put a whole school's photos inside a
 * 500MB Postgres allowance and dragged them along with every query that
 * touched a student. Storage is the right home: bigger allowance, served
 * separately, cacheable per image.
 *
 * Photos are minors' PII, so the bucket is private. Nothing here ever hands a
 * public URL to a browser — reads go through the backend, which is already
 * authenticating the caller.
 *
 * Disabled (and every call a no-op returning null) unless SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are both set, so file-storage and offline installs
 * are unaffected.
 */
final class SupabaseStorage {

    private final String baseUrl;
    private final String serviceKey;
    private final String bucket;
    private final HttpClient client;

    private static SupabaseStorage instance;
    private static boolean initialised;

    private SupabaseStorage(String baseUrl, String serviceKey, String bucket) {
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.serviceKey = serviceKey;
        this.bucket = bucket;
        this.client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
    }

    /** Null when storage isn't configured — callers fall back to inline photos. */
    static synchronized SupabaseStorage get() {
        if (initialised)
            return instance;
        initialised = true;

        String url = System.getenv("SUPABASE_URL");
        String key = System.getenv("SUPABASE_SERVICE_ROLE_KEY");
        String bucket = System.getenv().getOrDefault("SUPABASE_STORAGE_BUCKET", "student-photos");

        if (url == null || url.isBlank() || key == null || key.isBlank()) {
            System.out.println("Supabase Storage: not configured — photos stay inline in the database.");
            return null;
        }
        instance = new SupabaseStorage(url, key, bucket);
        System.out.println("Supabase Storage: enabled (bucket \"" + bucket + "\")");
        return instance;
    }

    /** True if the value is an inline data URL rather than a storage path. */
    static boolean isDataUrl(String value) {
        return value != null && value.startsWith("data:");
    }

    /** True if the value looks like something we put in the bucket. */
    static boolean isStoragePath(String value) {
        return value != null && !value.isBlank() && !isDataUrl(value) && !value.startsWith("http");
    }

    /**
     * Uploads a {@code data:image/...;base64,...} URL and returns the object
     * path to store on the record. Returns null if the input isn't a data URL
     * or the upload fails — callers keep the original value in that case, so a
     * storage outage degrades to the old behaviour rather than losing a photo.
     */
    String uploadDataUrl(String dataUrl, String path) {
        if (!isDataUrl(dataUrl))
            return null;

        int comma = dataUrl.indexOf(',');
        if (comma < 0)
            return null;
        String header = dataUrl.substring(0, comma);
        String contentType = header.startsWith("data:") && header.contains(";")
                ? header.substring(5, header.indexOf(';'))
                : "application/octet-stream";

        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(dataUrl.substring(comma + 1));
        } catch (IllegalArgumentException e) {
            System.err.println("Storage upload skipped — photo is not valid base64: " + e.getMessage());
            return null;
        }

        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/storage/v1/object/" + bucket + "/" + path))
                    .timeout(Duration.ofSeconds(60))
                    .header("Authorization", "Bearer " + serviceKey)
                    .header("Content-Type", contentType)
                    // Re-uploading a student's photo should replace it, not
                    // fail with "already exists".
                    .header("x-upsert", "true")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(bytes))
                    .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                System.err.println("Storage upload failed (" + response.statusCode() + "): " + response.body());
                return null;
            }
            return path;
        } catch (Exception e) {
            System.err.println("Storage upload failed: " + e.getMessage());
            return null;
        }
    }

    /** Downloads an object. Returns null if missing or unreachable. */
    byte[] download(String path) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/storage/v1/object/" + bucket + "/" + path))
                    .timeout(Duration.ofSeconds(60))
                    .header("Authorization", "Bearer " + serviceKey)
                    .GET()
                    .build();
            HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() / 100 != 2)
                return null;
            return response.body();
        } catch (Exception e) {
            System.err.println("Storage download failed: " + e.getMessage());
            return null;
        }
    }

    /** Best-effort delete. A leftover object is harmless; a failed save isn't. */
    void delete(String path) {
        if (!isStoragePath(path))
            return;
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/storage/v1/object/" + bucket + "/" + path))
                    .timeout(Duration.ofSeconds(30))
                    .header("Authorization", "Bearer " + serviceKey)
                    .DELETE()
                    .build();
            client.send(request, HttpResponse.BodyHandlers.discarding());
        } catch (Exception e) {
            System.err.println("Storage delete failed for " + path + ": " + e.getMessage());
        }
    }

    /** Creates the bucket if it isn't there yet. Private, always. */
    void ensureBucket() {
        try {
            String body = "{\"name\":\"" + Json.escape(bucket) + "\",\"id\":\"" + Json.escape(bucket)
                    + "\",\"public\":false}";
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/storage/v1/bucket"))
                    .timeout(Duration.ofSeconds(30))
                    .header("Authorization", "Bearer " + serviceKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            // 409 = already exists, which is the normal case after first run.
            if (response.statusCode() / 100 != 2 && response.statusCode() != 409)
                System.err.println("Could not create storage bucket (" + response.statusCode() + "): "
                        + response.body());
        } catch (Exception e) {
            System.err.println("Could not create storage bucket: " + e.getMessage());
        }
    }

    /** Object path for a student's photo. Stable, so re-uploads overwrite. */
    static String studentPhotoPath(String studentId) {
        return "students/" + studentId.replaceAll("[^A-Za-z0-9._-]", "_") + ".jpg";
    }
}
