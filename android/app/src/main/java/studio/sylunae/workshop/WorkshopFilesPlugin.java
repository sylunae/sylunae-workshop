package studio.sylunae.workshop;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.graphics.BitmapFactory;
import android.graphics.Bitmap;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** All imported media is streamed to private storage; no broad storage permission is used. */
@CapacitorPlugin(name = "WorkshopFiles")
public class WorkshopFilesPlugin extends Plugin {
    private final ExecutorService databaseQueue = Executors.newSingleThreadExecutor();
    private final ExecutorService fileQueue = Executors.newSingleThreadExecutor();
    private SQLiteDatabase database;

    @Override public void load() {
        database = getContext().openOrCreateDatabase("workshop-v1.db", 0, null);
        database.enableWriteAheadLogging();
        database.execSQL("CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
        database.execSQL("CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
        ChunkedRecords.initialize(database);
    }

    static File privateFile(android.content.Context context, String relative) throws IOException {
        if (relative == null || relative.isEmpty() || relative.contains(":") || relative.startsWith("/")) throw new IOException("文件不在应用私有目录中，请重新导入。");
        File root = context.getFilesDir().getCanonicalFile();
        File file = new File(root, relative).getCanonicalFile();
        if (!file.getPath().startsWith(root.getPath() + File.separator)) throw new IOException("无效的文件路径");
        return file;
    }

    private void putRecord(String table, String id, Object value) {
        ChunkedRecords.put(database,table,id,value);
    }
    private Object getRecord(String id) throws Exception {
        return ChunkedRecords.get(database,"records",id);
    }
    private JSObject loadSnapshot() throws Exception {
        JSObject result = new JSObject();
        try (Cursor rows = database.rawQuery("SELECT id FROM records WHERE id NOT LIKE 'resource:%'", null)) {
            while (rows.moveToNext()) result.put(rows.getString(0), ChunkedRecords.get(database,"records",rows.getString(0)));
        }
        JSArray notes = new JSArray();
        try (Cursor rows = database.rawQuery("SELECT id FROM notes", null)) { while (rows.moveToNext()) notes.put(ChunkedRecords.get(database,"notes",rows.getString(0))); }
        result.put("notes", notes); return result;
    }
    private void saveSnapshot(JSONObject patch, boolean replace) throws JSONException {
        database.beginTransaction();
        try {
            if (replace) { ChunkedRecords.clear(database,"records"); ChunkedRecords.clear(database,"notes"); }
            Iterator<String> keys = patch.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (key.equals("noteChanges")) {
                    JSONObject changes = patch.getJSONObject(key);
                    JSONArray puts = changes.getJSONArray("put"), deletes = changes.getJSONArray("delete");
                    for (int i=0;i<puts.length();i++) { JSONObject note = puts.getJSONObject(i); putRecord("notes", note.getString("id"), note); }
                    for (int i=0;i<deletes.length();i++) ChunkedRecords.delete(database,"notes",deletes.getString(i));
                } else if (key.equals("notes")) {
                    JSONArray notes = patch.getJSONArray(key); ChunkedRecords.clear(database,"notes");
                    for (int i=0;i<notes.length();i++) { JSONObject note = notes.getJSONObject(i); putRecord("notes", note.getString("id"), note); }
                } else if (Arrays.asList("version", "settings", "bangumi", "tracks", "albums", "folders", "goals", "todos", "recurringTodos", "todoCompletionRecords", "pomodoro", "countdowns", "clipboardSnippets", "launcherLinks", "birthdays", "imageLibrary").contains(key)) putRecord("records", key, patch.get(key));
            }
            database.setTransactionSuccessful();
        } finally { database.endTransaction(); }
    }

    @PluginMethod public void run(PluginCall call) {
        String operation = call.getString("op", "");
        (operation.startsWith("storage:") || operation.startsWith("record:") ? databaseQueue : fileQueue).execute(() -> {
            try {
                JSObject result = new JSObject();
                switch (operation) {
                    case "storage:manifest": {
                        for(String scope:Arrays.asList("records","notes")) {
                            JSArray ids=new JSArray();
                            try(Cursor rows=database.rawQuery("SELECT id FROM "+scope+(scope.equals("records")?" WHERE id NOT LIKE 'resource:%'":""),null)) {while(rows.moveToNext())ids.put(rows.getString(0));}
                            result.put(scope,ids);
                        } break;
                    }
                    case "storage:readChunk": {
                        byte[] bytes=ChunkedRecords.chunk(database,call.getString("scope"),call.getString("id"),call.getInt("part",0));
                        result.put("data",bytes==null?JSONObject.NULL:Base64.encodeToString(bytes,Base64.NO_WRAP));break;
                    }
                    case "storage:stage": ChunkedRecords.stage(database,call.getString("token"),call.getString("scope"),call.getString("id"),call.getInt("part",0),Base64.decode(call.getString("data"),Base64.DEFAULT));break;
                    case "storage:commit": ChunkedRecords.commit(database,call.getString("token"),call.getBoolean("replace",false),call.getArray("deletedNotes"),call.getBoolean("driveRestore",false));break;
                    case "storage:abort": database.delete("import_chunks","token=?",new String[]{call.getString("token")});break;
                    case "storage:hasDriveRollback": result.put("available",ChunkedRecords.hasDriveRollback(database));break;
                    case "storage:rollbackDrive": ChunkedRecords.rollbackDrive(database);break;
                    case "storage:load": call.resolve(loadSnapshot()); return;
                    case "storage:save": saveSnapshot(call.getObject("patch"), false); break;
                    case "storage:replace": saveSnapshot(call.getObject("snapshot"), true); break;
                    case "record:get": result.put("value", getRecord("resource:" + call.getString("key"))); break;
                    case "record:set": putRecord("records", "resource:" + call.getString("key"), call.getData().get("value")); break;
                    case "exists": {
                        JSObject found = new JSObject(); JSONArray paths = call.getArray("paths");
                        for (int i=0;i<paths.length();i++) { String path = paths.getString(i); boolean exists = false; try { exists = privateFile(getContext(), path).isFile(); } catch (IOException ignored) {} found.put(path, exists); }
                        result.put("paths", found); break;
                    }
                    case "uri": result.put("uri", Uri.fromFile(privateFile(getContext(), call.getString("path"))).toString()); break;
                    case "thumbnails": {
                        JSObject uris = new JSObject(); JSONArray requests = call.getArray("requests");
                        for (int i=0;i<requests.length();i++) {
                            JSONObject request = requests.getJSONObject(i); String path = request.getString("path");
                            try { uris.put(path, thumbnail(path, Math.max(64, Math.min(2048, request.optInt("maxEdge", 512))))); }
                            catch (Exception error) { uris.put(path, ""); }
                        }
                        result.put("uris", uris); break;
                    }
                    case "bundled": {
                        String asset = call.getString("asset", "").replaceFirst("^\\./", "");
                        if (asset.startsWith("/") || asset.contains("..")) throw new IOException("无效的内置资源路径");
                        File output = privateFile(getContext(), call.getString("path")); output.getParentFile().mkdirs();
                        try (InputStream in = getContext().getAssets().open("public/"+asset); FileOutputStream out = new FileOutputStream(output)) { copy(in, out); out.getFD().sync(); }
                        result.put("size", output.length()); break;
                    }
                    case "metadata": result = music(privateFile(getContext(), call.getString("path")), call.getString("path")); break;
                    case "putAsset": {
                        byte[] bytes = Base64.decode(call.getString("data"), Base64.DEFAULT);
                        String hash = hex(MessageDigest.getInstance("SHA-256").digest(bytes));
                        String mime = call.getString("mime", "image/png");
                        if (!mime.matches("image/[a-zA-Z0-9.+-]+")) throw new IOException("不支持的图片类型");
                        File file = privateFile(getContext(), "note-assets/"+hash); file.getParentFile().mkdirs();
                        atomicWrite(file, bytes);
                        atomicWrite(new File(file.getPath()+".mime"), mime.getBytes(StandardCharsets.UTF_8));
                        result.put("id", hash); break;
                    }
                    case "getAsset": {
                        String id = call.getString("id", ""); if (!id.matches("[a-f0-9]{64}")) throw new IOException("无效的附件引用");
                        File file = privateFile(getContext(), "note-assets/"+id);
                        if (file.isFile()) { result.put("data", Base64.encodeToString(readBytes(file, 32*1024*1024), Base64.NO_WRAP)); result.put("mime", new String(readBytes(new File(file.getPath()+".mime"), 256), StandardCharsets.UTF_8)); }
                        break;
                    }
                    case "updateMetadata": {
                        JSONObject update = call.getObject("update"); String path = update.getString("path"); File file = privateFile(getContext(), path);
                        JSONObject metadata = update.getJSONObject("metadata"); JSONObject cover = update.getJSONObject("cover");
                        JSObject track = music(file, path); String mode = cover.getString("mode");
                        if (mode.equals("remove")) metadata.put("cover", "");
                        else if (mode.equals("replace")) {
                            File artwork = new File(file.getPath()+".cover"); atomicWrite(artwork, Base64.decode(cover.getString("data"), Base64.DEFAULT));
                            metadata.put("cover", Uri.fromFile(artwork).toString());
                        }
                        else metadata.put("cover", track.getString("cover"));
                        atomicWrite(new File(file.getPath()+".json"), metadata.toString().getBytes(StandardCharsets.UTF_8));
                        result = music(file, path); break;
                    }
                    case "download": {
                        URL url = new URL(call.getString("url")); if (!url.getProtocol().equals("https")) throw new IOException("下载地址必须使用 HTTPS");
                        String path = call.getString("path"); File output = privateFile(getContext(), path); output.getParentFile().mkdirs();
                        File temp = File.createTempFile("download-", ".part", output.getParentFile());
                        try {
                            URLConnection connection = url.openConnection(); connection.setConnectTimeout(20000); connection.setReadTimeout(30000);
                            try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(temp)) { copy(in, out); out.getFD().sync(); }
                            String expected = call.getString("sha256", "");
                            if (!expected.isEmpty() && !expected.equals(hashFile(temp))) throw new IOException("下载校验失败，请重试");
                            String committedPath = path;
                            if (call.getBoolean("music", false)) {
                                committedPath = "music/"+hashFile(temp)+"/"+call.getString("name", "download.audio");
                                output = privateFile(getContext(), committedPath); output.getParentFile().mkdirs();
                                if (!output.exists() && !temp.renameTo(output)) throw new IOException("无法提交音频文件");
                            } else if (!temp.renameTo(output)) throw new IOException("无法提交下载文件");
                            result.put("path", committedPath); result.put("size", output.length());
                        } finally { temp.delete(); } break;
                    }
                    case "remove": { File file = privateFile(getContext(), call.getString("path")); if (file.exists() && !file.delete()) throw new IOException("无法删除文件"); break; }
                    case "backup:release": {
                        String name=call.getString("name","");if(!name.matches("backup-preview-[a-f0-9-]+\\.json"))throw new IOException("无效的备份暂存文件");
                        new File(getContext().getCacheDir(),name).delete();break;
                    }
                    case "export:append": {
                        String path=call.getString("path","");if(!path.matches("exports/[a-f0-9-]+\\.json"))throw new IOException("无效的导出暂存文件");
                        File file=privateFile(getContext(),path);file.getParentFile().mkdirs();
                        try(FileOutputStream out=new FileOutputStream(file,!call.getBoolean("first",false))){out.write(Base64.decode(call.getString("data"),Base64.DEFAULT));}break;
                    }
                    default: throw new IOException("未知的原生操作: "+operation);
                }
                call.resolve(result);
            } catch (Exception error) { call.reject(error.getMessage(), error); }
            catch (OutOfMemoryError error) { call.reject("单条数据超过设备可用内存，请缩小附件后重试。原有数据未被替换。"); }
        });
    }

    @PluginMethod public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE);
        String kind = call.getString("kind", "music");
        intent.setType(kind.equals("music") || kind.equals("alarm") || kind.equals("resource") ? "audio/*" : kind.equals("image") ? "image/*" : "*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, call.getBoolean("multiple", true));
        startActivityForResult(call, intent, "picked");
    }
    @ActivityCallback private void picked(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        Intent data = activityResult.getData();
        if (activityResult.getResultCode() != Activity.RESULT_OK || data == null) { call.resolve(new JSObject().put("items", new JSArray())); return; }
        fileQueue.execute(() -> {
            try {
                JSArray items = new JSArray(); ArrayList<Uri> uris = new ArrayList<>();
                if (data.getClipData() != null) for (int i=0;i<data.getClipData().getItemCount();i++) uris.add(data.getClipData().getItemAt(i).getUri());
                else if (data.getData() != null) uris.add(data.getData());
                String kind = call.getString("kind", "music");
                for (Uri uri: uris) {
                    if (kind.equals("backup")) {
                        File prepared=BackupMediaReader.prepare(getContext(),uri);
                        items.put(new JSObject().put("uri",Uri.fromFile(prepared).toString()).put("name",prepared.getName()));
                    } else items.put(importFile(uri, kind));
                }
                call.resolve(new JSObject().put("items", items));
            } catch (Exception error) { call.reject(error.getMessage(), error); }
            catch (OutOfMemoryError error) { call.reject("备份中的单个附件超过设备可用内存，请缩小附件后重试。原有数据未被替换。"); }
        });
    }
    @PluginMethod public void exportFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/json")); intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "sylunae-backup.json"));
        startActivityForResult(call, intent, "exported");
    }
    @ActivityCallback private void exported(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) { call.resolve(new JSObject().put("saved", false)); return; }
        fileQueue.execute(() -> {
            try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (call.getString("path") != null) {
                    try (InputStream in = new FileInputStream(privateFile(getContext(), call.getString("path")))) { copy(in, out); }
                } else {
                    byte[] bytes = call.getBoolean("base64", false) ? Base64.decode(call.getString("contents"), Base64.DEFAULT) : call.getString("contents").getBytes(StandardCharsets.UTF_8);
                    out.write(bytes);
                }
                call.resolve(new JSObject().put("saved", true));
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void openExternal(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("url"));
            if (!Arrays.asList("https", "http", "mailto").contains(uri.getScheme())) throw new IOException("不支持的链接类型");
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri)); call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }
    @PluginMethod public void appearance(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                boolean dark = call.getBoolean("dark", false);
                androidx.core.view.WindowInsetsControllerCompat controls = androidx.core.view.WindowCompat.getInsetsController(getActivity().getWindow(), getActivity().getWindow().getDecorView());
                controls.setAppearanceLightStatusBars(!dark); controls.setAppearanceLightNavigationBars(!dark);
                getActivity().getWindow().getDecorView().setBackgroundColor(android.graphics.Color.parseColor(call.getString("background", "#f7f7f7")));
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    JSObject importFile(Uri uri, String kind) throws Exception {
        String name = "导入文件";
        try (Cursor row = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) { if (row != null && row.moveToFirst()) name = row.getString(0); }
        String directory = kind.equals("image") ? "images" : kind.equals("resource") ? "resources/imports" : "music";
        File dir = privateFile(getContext(), directory); dir.mkdirs(); File temp = File.createTempFile("import-", ".part", dir);
        try {
            try (InputStream in = getContext().getContentResolver().openInputStream(uri); FileOutputStream out = new FileOutputStream(temp)) { copy(in, out); out.getFD().sync(); }
            String hash = hashFile(temp); String safeName = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            String relative = directory+"/"+hash+"/"+safeName;
            File target = privateFile(getContext(), relative); target.getParentFile().mkdirs();
            if (!target.exists() && !temp.renameTo(target)) throw new IOException("无法保存导入文件");
            if (kind.equals("image")) {
                BitmapFactory.Options dimensions = new BitmapFactory.Options(); dimensions.inJustDecodeBounds = true; BitmapFactory.decodeFile(target.getPath(), dimensions);
                if (dimensions.outWidth <= 0) throw new IOException("无法读取图片: "+name);
                int dot = name.lastIndexOf('.'); long now = System.currentTimeMillis(); String timestamp = timestamp();
                return new JSObject().put("id", hash).put("rootId", JSONObject.NULL).put("collectionIds", new JSArray()).put("path", relative).put("relativePath", name).put("name", name).put("extension", dot < 0 ? "" : name.substring(dot+1).toLowerCase(Locale.ROOT)).put("size", target.length()).put("mtimeMs", now).put("width", dimensions.outWidth).put("height", dimensions.outHeight).put("aspectType", dimensions.outWidth == dimensions.outHeight ? "square" : dimensions.outWidth > dimensions.outHeight ? "landscape" : "portrait").put("identity", hash).put("hash", hash).put("missing", false).put("metadata", new JSObject()).put("createdAt", timestamp).put("updatedAt", timestamp);
            }
            JSObject track = music(target, relative); track.put("id", hash); return track;
        } finally { temp.delete(); }
    }
    private String thumbnail(String path, int edge) throws Exception {
        File source = privateFile(getContext(), path); if (!source.isFile()) return "";
        String key = hex(MessageDigest.getInstance("SHA-256").digest((path+":"+source.length()+":"+source.lastModified()+":"+edge).getBytes(StandardCharsets.UTF_8)));
        File directory = new File(getContext().getCacheDir(), "thumbnails"); directory.mkdirs();
        File output = new File(directory, key+".jpg");
        if (!output.isFile()) {
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true; BitmapFactory.decodeFile(source.getPath(), options);
            options.inSampleSize = 1; while (Math.max(options.outWidth, options.outHeight)/options.inSampleSize > edge*2) options.inSampleSize *= 2;
            options.inJustDecodeBounds = false; Bitmap bitmap = BitmapFactory.decodeFile(source.getPath(), options);
            if (bitmap == null) return "";
            try {
                Matrix transform = new Matrix();
                try {
                    ExifInterface exif = new ExifInterface(source.getPath()); int orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                    if (orientation == ExifInterface.ORIENTATION_ROTATE_90) transform.postRotate(90);
                    else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) transform.postRotate(180);
                    else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) transform.postRotate(270);
                } catch (IOException ignored) {}
                float scale = Math.min(1f, edge/(float)Math.max(bitmap.getWidth(), bitmap.getHeight())); transform.postScale(scale, scale);
                Bitmap scaled = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), transform, true);
                try (FileOutputStream out = new FileOutputStream(output)) { scaled.compress(Bitmap.CompressFormat.JPEG, 85, out); }
                if (scaled != bitmap) scaled.recycle();
            } finally { bitmap.recycle(); }
        }
        return Uri.fromFile(output).toString();
    }
    private JSObject music(File file, String path) throws Exception {
        MediaMetadataRetriever reader = new MediaMetadataRetriever(); JSObject result = new JSObject();
        try {
            reader.setDataSource(file.getPath()); String now = timestamp();
            result.put("id", hashFile(file)).put("path", path).put("title", value(reader, MediaMetadataRetriever.METADATA_KEY_TITLE, file.getName().replaceFirst("\\.[^.]+$", ""))).put("artist", value(reader, MediaMetadataRetriever.METADATA_KEY_ARTIST, "未知艺术家")).put("album", value(reader, MediaMetadataRetriever.METADATA_KEY_ALBUM, "未知专辑")).put("albumArtist", value(reader, MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST, "")).put("albumId", JSONObject.NULL).put("duration", Double.parseDouble(value(reader, MediaMetadataRetriever.METADATA_KEY_DURATION, "0"))/1000).put("missing", false).put("createdAt", now).put("updatedAt", now);
            byte[] cover = reader.getEmbeddedPicture();
            File artwork = new File(file.getPath()+".embedded-cover");
            if (cover != null && !artwork.isFile()) atomicWrite(artwork, cover);
            result.put("cover", artwork.isFile() ? Uri.fromFile(artwork).toString() : "");
            result.put("genre", value(reader, MediaMetadataRetriever.METADATA_KEY_GENRE, "")).put("year", JSONObject.NULL).put("track", JSONObject.NULL).put("comment", "");
            File sidecar = new File(file.getPath()+".json"); if (sidecar.isFile()) {
                JSONObject edits = new JSONObject(new String(readBytes(sidecar, 4*1024*1024), StandardCharsets.UTF_8));
                for (String key: Arrays.asList("title", "artist", "album", "cover", "genre", "year", "track", "comment")) if (edits.has(key)) result.put(key, edits.get(key));
            }
            return result;
        } finally { reader.release(); }
    }
    private static String value(MediaMetadataRetriever reader, int key, String fallback) { String value = reader.extractMetadata(key); return value == null || value.isEmpty() ? fallback : value; }
    private static String timestamp() { java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US); format.setTimeZone(TimeZone.getTimeZone("UTC")); return format.format(new Date()); }
    static void copy(InputStream in, OutputStream out) throws IOException { if (in == null || out == null) throw new IOException("无法打开文件"); byte[] buffer = new byte[64*1024]; int count; while ((count=in.read(buffer)) != -1) out.write(buffer, 0, count); }
    static byte[] readLimited(InputStream in, int limit) throws IOException { ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[64*1024]; int count; while ((count=in.read(buffer)) != -1) { if (out.size()+count > limit) throw new IOException("文件过大"); out.write(buffer,0,count); } return out.toByteArray(); }
    static byte[] readBytes(File file, int limit) throws IOException { try (InputStream in = new FileInputStream(file)) { return readLimited(in, limit); } }
    static void atomicWrite(File file, byte[] bytes) throws IOException { File temp = File.createTempFile("write-", ".part", file.getParentFile()); try { try (FileOutputStream out = new FileOutputStream(temp)) { out.write(bytes); out.getFD().sync(); } if (!temp.renameTo(file)) throw new IOException("无法提交文件"); } finally { temp.delete(); } }
    static String hashFile(File file) throws Exception { MessageDigest digest = MessageDigest.getInstance("SHA-256"); try (InputStream in = new FileInputStream(file)) { byte[] buffer = new byte[64*1024]; int count; while ((count=in.read(buffer)) != -1) digest.update(buffer,0,count); } return hex(digest.digest()); }
    static String hex(byte[] data) { StringBuilder out = new StringBuilder(); for (byte value: data) out.append(String.format("%02x", value & 255)); return out.toString(); }
    @Override protected void handleOnDestroy() { databaseQueue.execute(() -> database.close()); databaseQueue.shutdown(); fileQueue.shutdown(); }
}
