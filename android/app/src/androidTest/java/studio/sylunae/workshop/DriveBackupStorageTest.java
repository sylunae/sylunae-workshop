package studio.sylunae.workshop;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;

import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class DriveBackupStorageTest {
    @Test public void replacementAndRollbackIncludeNotesAndWhiteNoiseInOneTransaction() throws Exception {
        try (SQLiteDatabase database = SQLiteDatabase.create(null)) {
            database.execSQL("CREATE TABLE records(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
            database.execSQL("CREATE TABLE notes(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
            ChunkedRecords.initialize(database);
            JSONObject original = new JSONObject().put("text", "月".repeat(90_000));
            JSONArray sounds = new JSONArray("[{\"id\":\"official\",\"origin\":\"official\"},{\"id\":\"phone\",\"origin\":\"custom\"}]");
            ChunkedRecords.put(database, "records", "settings", new JSONObject().put("theme", "dark"));
            ChunkedRecords.put(database, "records", "resource:resources", sounds);
            ChunkedRecords.put(database, "notes", "old-note", original);
            ChunkedRecords.put(database, "records", "resource:other", new JSONObject().put("retained", true));

            String first = UUID.randomUUID().toString();
            stage(database, first, "records", "settings", "{\"theme\":\"light\"}");
            stage(database, first, "records", "drive:whiteNoise", "[{\"id\":\"cloud\",\"origin\":\"custom\"}]");
            stage(database, first, "notes", "new-note", "{\"id\":\"new-note\"}");
            ChunkedRecords.commit(database, first, true, null, true);
            assertTrue(ChunkedRecords.hasDriveRollback(database));
            assertEquals("light", ((JSONObject) ChunkedRecords.get(database, "records", "settings")).getString("theme"));
            assertEquals(JSONObject.NULL, ChunkedRecords.get(database, "notes", "old-note"));
            JSONArray restored = (JSONArray) ChunkedRecords.get(database, "records", "resource:resources");
            assertEquals("official", restored.getJSONObject(0).getString("id"));
            assertEquals("cloud", restored.getJSONObject(1).getString("id"));

            String invalid = UUID.randomUUID().toString();
            stage(database, invalid, "records", "settings", "{\"theme\":\"system\"}");
            stage(database, invalid, "records", "drive:whiteNoise", "{}");
            try {
                ChunkedRecords.commit(database, invalid, true, null, true);
                fail("An invalid resource list must roll back the entire restore.");
            } catch (ClassCastException expected) {
                assertEquals("light", ((JSONObject) ChunkedRecords.get(database, "records", "settings")).getString("theme"));
            }
            ChunkedRecords.rollbackDrive(database);
            assertFalse(ChunkedRecords.hasDriveRollback(database));
            assertEquals(original.toString(), ChunkedRecords.get(database, "notes", "old-note").toString());
            assertEquals(sounds.toString(), ChunkedRecords.get(database, "records", "resource:resources").toString());
            assertTrue(((JSONObject) ChunkedRecords.get(database, "records", "resource:other")).getBoolean("retained"));
        }
    }

    @Test public void resumesOnlyVerifiedMediaAndRejectsCorruptFiles() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String contents = "drive-fixture-" + UUID.randomUUID();
        byte[] data = contents.getBytes(StandardCharsets.UTF_8);
        String sha256 = hash(data);
        File complete = WorkshopFilesPlugin.privateFile(context, "drive-objects/" + sha256);
        File partial = new File(complete.getPath() + ".part");
        File media = WorkshopFilesPlugin.privateFile(context, "drive-media/" + sha256 + ".png");
        File attachment = WorkshopFilesPlugin.privateFile(context, "note-assets/" + sha256);
        File mime = new File(attachment.getPath() + ".mime");
        try {
            assertThrows(IOException.class, () -> WorkshopDriveFiles.download(context, sha256, data.length, range -> {
                assertEquals("", range);
                return response(200, null, contents.substring(0, 5));
            }));
            assertFalse(complete.exists());
            assertEquals(5, partial.length());
            assertEquals(data.length - 5, WorkshopDriveFiles.remainingBytes(context, sha256, data.length));
            assertEquals(complete, WorkshopDriveFiles.download(context, sha256, data.length, range -> {
                assertEquals("bytes=5-", range);
                return response(206, "bytes 5-" + (data.length - 1) + "/" + data.length, contents.substring(5));
            }));
            assertArrayEquals(data, Files.readAllBytes(complete.toPath()));
            assertEquals(complete, WorkshopDriveFiles.download(context, sha256, data.length, range -> { throw new AssertionError("Download must reuse a verified file"); }));
            WorkshopDriveFiles.materialize(context, sha256, "path", ".png", "image/png");
            WorkshopDriveFiles.materialize(context, sha256, "note", "", "image/png");
            assertArrayEquals(data, Files.readAllBytes(media.toPath()));
            assertArrayEquals(data, Files.readAllBytes(attachment.toPath()));
            assertEquals("image/png", new String(Files.readAllBytes(mime.toPath()), StandardCharsets.UTF_8));
            assertTrue(complete.delete());
            assertThrows(IOException.class, () -> WorkshopDriveFiles.download(context, sha256, data.length,
                range -> response(200, null, "x".repeat(data.length))));
            assertFalse(complete.exists());
            assertFalse(partial.exists());
        } finally {
            for (File file : new File[]{complete, partial, media, attachment, mime}) file.delete();
        }
    }

    private static void stage(SQLiteDatabase database, String token, String scope, String id, String json) {
        ChunkedRecords.stage(database, token, scope, id, 0, json.getBytes(StandardCharsets.UTF_8));
    }

    private static String hash(byte[] data) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte value : MessageDigest.getInstance("SHA-256").digest(data)) result.append(String.format(Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }

    private static HttpURLConnection response(int status, String contentRange, String text) throws Exception {
        return new HttpURLConnection(new URL("https://www.googleapis.com")) {
            @Override public int getResponseCode() { return status; }
            @Override public String getHeaderField(String name) { return "Content-Range".equals(name) ? contentRange : null; }
            @Override public InputStream getInputStream() { return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)); }
            @Override public void connect() {}
            @Override public void disconnect() {}
            @Override public boolean usingProxy() { return false; }
        };
    }
}
