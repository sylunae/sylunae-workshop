package studio.sylunae.workshop;

import android.accounts.Account;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.StatFs;
import android.system.Os;
import android.util.Base64;
import androidx.activity.result.IntentSenderRequest;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "WorkshopDrive")
public class WorkshopDrivePlugin extends Plugin {
    private static final String SCOPE = "https://www.googleapis.com/auth/drive.appdata";
    private static final String API = "https://www.googleapis.com/drive/v3";
    private final ExecutorService queue = Executors.newSingleThreadExecutor();
    private volatile boolean connecting;
    private String accessToken;
    private final LinkedHashMap<String, String> inspectedHashes = new LinkedHashMap<>(16, 0.75f, true);

    @Override protected void handleOnDestroy() {
        queue.shutdownNow();
        super.handleOnDestroy();
    }

    private SharedPreferences accountPreferences() {
        return getContext().getSharedPreferences("google-drive-account", Context.MODE_PRIVATE);
    }

    private AuthorizationRequest request(String email) {
        AuthorizationRequest.Builder builder = AuthorizationRequest.builder().setRequestedScopes(Collections.singletonList(new Scope(SCOPE)));
        if (!email.isEmpty()) builder.setAccount(new Account(email, "com.google"));
        return builder.build();
    }

    @PluginMethod public void status(PluginCall call) {
        SharedPreferences preferences = accountPreferences();
        String id = preferences.getString("id", "");
        JSObject result = new JSObject().put("configured", true).put("connected", !id.isEmpty());
        if (!id.isEmpty()) result.put("account", new JSObject().put("id", id).put("label", preferences.getString("label", "Google Drive")));
        call.resolve(result);
    }

    @PluginMethod public void connect(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (connecting) { call.reject("Google Drive 正在等待授权。"); return; }
            connecting = true;
            try {
                Identity.getAuthorizationClient(getActivity()).authorize(request(""))
                    .addOnSuccessListener(result -> {
                        try {
                            if (!result.hasResolution()) {
                                finishAuthorization(call, result);
                                return;
                            }
                            if (result.getPendingIntent() == null) throw new IOException("无法打开 Google 授权页面。");
                            IntentSenderRequest intent = new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build();
                            ((MainActivity) getActivity()).authorizeDrive(intent, response -> {
                                try {
                                    if (response.getResultCode() != Activity.RESULT_OK) throw new IOException("Google 授权已取消。");
                                    finishAuthorization(call, Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(response.getData()));
                                } catch (Exception error) { failAuthorization(call, error, "Google 授权未完成。"); }
                            });
                        } catch (Exception error) { failAuthorization(call, error, "无法完成 Google 授权。"); }
                    })
                    .addOnFailureListener(error -> failAuthorization(call, error, "Google 授权失败。请检查手机上的 Google Play 服务、应用包名和签名配置。"));
            } catch (RuntimeException error) {
                failAuthorization(call, error, "无法启动 Google 授权。");
            }
        });
    }

    private void failAuthorization(PluginCall call, Exception error, String message) {
        connecting = false;
        call.reject(error instanceof IOException ? error.getMessage() : message, error);
    }

    private void finishAuthorization(PluginCall call, AuthorizationResult result) {
        queue.execute(() -> {
            try {
                String token = result.getAccessToken();
                JSONObject user = user(token);
                String id = user.getString("permissionId"), email = user.optString("emailAddress");
                String label = email.isEmpty() ? user.optString("displayName", "Google Drive") : email;
                accountPreferences().edit().putString("id", id).putString("email", email).putString("label", label).apply();
                accessToken = token;
                call.resolve(new JSObject().put("id", id).put("label", label));
            } catch (Exception error) { failAuthorization(call, error, "无法读取当前 Drive 账号。"); }
            finally { connecting = false; }
        });
    }

    @PluginMethod public void disconnect(PluginCall call) {
        run(call, () -> {
            accessToken = null;
            accountPreferences().edit().clear().apply();
            return new JSObject();
        });
    }

    @PluginMethod public void latest(PluginCall call) {
        run(call, () -> {
            String role = call.getBoolean("notebook", false) ? "notebook-v1" : "manifest-v1";
            Uri url = Uri.parse(API + "/files").buildUpon()
                .appendQueryParameter("spaces", "appDataFolder")
                .appendQueryParameter("q", "trashed = false and appProperties has { key='sylunae' and value='" + role + "' }")
                .appendQueryParameter("orderBy", "createdTime desc")
                .appendQueryParameter("pageSize", "1")
                .appendQueryParameter("fields", "nextPageToken,files(id,size,sha256Checksum)").build();
            String pageToken = "";
            do {
                Uri page = pageToken.isEmpty() ? url : url.buildUpon().appendQueryParameter("pageToken", pageToken).build();
                JSONObject listing = WorkshopDriveFiles.json(open(page.toString(), ""), 256 * 1024);
                JSONObject file = listing.getJSONArray("files").optJSONObject(0);
                if (file != null) return downloadManifest(file);
                pageToken = listing.optString("nextPageToken");
            } while (!pageToken.isEmpty());
            return new JSObject().put("id", JSONObject.NULL);
        });
    }

    @PluginMethod public void revision(PluginCall call) {
        run(call, () -> {
            String id = call.getString("id", "");
            if (!id.matches("[A-Za-z0-9_-]{1,256}")) throw new IOException("云端文件 ID 无效。");
            JSONObject file = WorkshopDriveFiles.json(open(API + "/files/" + id + "?fields=id,size,sha256Checksum", ""), 256 * 1024);
            return downloadManifest(file);
        });
    }

    private JSObject downloadManifest(JSONObject file) throws Exception {
        long size = file.getLong("size");
        if (size > 16 * 1024 * 1024) throw new IOException("云端备份清单过大。");
        return download(file.getString("id"), file.getString("sha256Checksum"), size);
    }

    @PluginMethod public void download(PluginCall call) {
        run(call, () -> download(call.getString("id"), call.getString("sha256"), call.getData().getLong("size")));
    }

    @PluginMethod public void objects(PluginCall call) {
        run(call, () -> {
            Uri.Builder query = Uri.parse(API + "/files").buildUpon()
                .appendQueryParameter("spaces", "appDataFolder")
                .appendQueryParameter("q", "trashed = false and appProperties has { key='sylunae' and value='object-v1' }")
                .appendQueryParameter("pageSize", "1000")
                .appendQueryParameter("fields", "nextPageToken,files(id,size,sha256Checksum)");
            String page = call.getString("page", "");
            if (!page.isEmpty()) query.appendQueryParameter("pageToken", page);
            return JSObject.fromJSONObject(WorkshopDriveFiles.json(open(query.build().toString(), ""), 1024 * 1024));
        });
    }

    @PluginMethod public void stage(PluginCall call) {
        run(call, () -> {
            String path = stagedPath(call);
            File file = uploadFile(path);
            File directory = file.getParentFile();
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建备份暂存目录。");
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            if (bytes.length > 128 * 1024) throw new IOException("备份分块过大。");
            try (FileOutputStream out = new FileOutputStream(file, !call.getBoolean("first", false))) { out.write(bytes); }
            return new JSObject().put("path", path);
        });
    }

    @PluginMethod public void discard(PluginCall call) {
        run(call, () -> {
            File directory = new File(getContext().getCacheDir(), "drive-upload");
            String prefix = uploadToken(call) + "-";
            File[] files = directory.listFiles((parent, name) -> name.startsWith(prefix));
            if (files != null) for (File file : files) if (file.isFile()) file.delete();
            return new JSObject();
        });
    }

    private static String uploadToken(PluginCall call) throws IOException {
        String token = call.getString("token", "");
        if (!token.matches("[a-f0-9-]{36}")) throw new IOException("备份任务标识无效。");
        return token;
    }

    private static String stagedPath(PluginCall call) throws IOException {
        String name = call.getString("name", "");
        if (!name.matches("[A-Za-z0-9]{1,48}")) throw new IOException("备份文件标识无效。");
        return "drive-upload/" + uploadToken(call) + "-" + name;
    }

    private File uploadFile(String path) throws IOException {
        if (path.matches("drive-upload/[a-f0-9-]{36}-[A-Za-z0-9]{1,48}")) return new File(getContext().getCacheDir(), path);
        if (path.startsWith("/_capacitor_file_") || path.startsWith("file://")) {
            String local = path.startsWith("file://") ? Uri.parse(path).getPath() : Uri.decode(path.substring("/_capacitor_file_".length()));
            if (local == null) throw new IOException("本地媒体路径无效。");
            File file = new File(local).getCanonicalFile();
            if (!file.getPath().startsWith(getContext().getFilesDir().getCanonicalPath() + File.separator)) throw new IOException("本地媒体路径无效。");
            return file;
        }
        return WorkshopFilesPlugin.privateFile(getContext(), path);
    }

    @PluginMethod public void inspect(PluginCall call) {
        run(call, () -> {
            File file = uploadFile(call.getString("path", ""));
            if (!file.isFile()) throw new IOException("无法读取备份文件。");
            long size = file.length();
            String signature = fileSignature(file);
            boolean staged = file.getParentFile().getName().equals("drive-upload");
            String hash = staged ? null : inspectedHashes.get(signature);
            if (hash == null) {
                hash = WorkshopFilesPlugin.hashFile(file);
                if (!signature.equals(fileSignature(file))) throw new IOException("文件正在修改，请重新检查备份。");
                if (!staged) {
                    if (inspectedHashes.size() >= 4096) inspectedHashes.remove(inspectedHashes.keySet().iterator().next());
                    inspectedHashes.put(signature, hash);
                }
            }
            String mime = "application/octet-stream";
            File sidecar = new File(file.getPath() + ".mime");
            if (file.getParentFile().getName().equals("note-assets") && sidecar.isFile()) {
                mime = new String(WorkshopFilesPlugin.readBytes(sidecar, 256), StandardCharsets.UTF_8);
            }
            return new JSObject().put("sha256", hash).put("size", size).put("mime", mime).put("name", file.getName());
        });
    }

    private static String fileSignature(File file) throws Exception {
        android.system.StructStat stat = Os.stat(file.getPath());
        return file.getPath() + ":" + stat.st_ino + ":" + stat.st_size + ":" + stat.st_ctime + ":" + file.lastModified();
    }

    @PluginMethod public void upload(PluginCall call) {
        run(call, () -> {
            File file = uploadFile(call.getString("path", ""));
            long size = call.getData().getLong("size");
            String hash = call.getString("sha256", "");
            boolean manifest = call.getBoolean("manifest", false);
            boolean notebook = call.getBoolean("notebook", false);
            if (!file.isFile() || size <= 0 || size != file.length() || !hash.matches("[a-f0-9]{64}")) {
                throw new IOException("备份文件已变化，请重新检查备份。");
            }
            String access = token();
            JSONObject metadata = new JSONObject()
                .put("name", notebook ? "sylunae-notebook-" + hash + ".json" : manifest ? "sylunae-backup-" + hash + ".json" : hash)
                .put("parents", new JSONArray().put("appDataFolder"))
                .put("appProperties", new JSONObject().put("sylunae", notebook ? "notebook-v1" : manifest ? "manifest-v1" : "object-v1"));
            HttpURLConnection initial = connection("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,sha256Checksum", access, "");
            String location;
            try {
                byte[] data = metadata.toString().getBytes(StandardCharsets.UTF_8);
                initial.setRequestMethod("POST");
                initial.setDoOutput(true);
                initial.setFixedLengthStreamingMode(data.length);
                initial.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                initial.setRequestProperty("X-Upload-Content-Type", "application/octet-stream");
                initial.setRequestProperty("X-Upload-Content-Length", Long.toString(size));
                try (OutputStream out = initial.getOutputStream()) { out.write(data); }
                int status = initial.getResponseCode();
                if (status == 401) accessToken = null;
                if (status < 200 || status >= 300) throw new IOException("Google Drive 上传失败（HTTP " + status + "）。");
                location = initial.getHeaderField("Location");
            } finally { initial.disconnect(); }
            if (location == null) throw new IOException("Google Drive 未返回上传地址。");
            URL session = new URL(location);
            if (!"https".equals(session.getProtocol()) || !"www.googleapis.com".equals(session.getHost()) || session.getPort() != -1) {
                throw new IOException("Google Drive 返回了无效的上传地址。");
            }
            HttpURLConnection request = connection(location, access, "");
            JSONObject uploaded;
            try {
                request.setRequestMethod("PUT");
                request.setDoOutput(true);
                request.setFixedLengthStreamingMode(size);
                request.setRequestProperty("Content-Type", "application/octet-stream");
                try (FileInputStream input = new FileInputStream(file); OutputStream out = request.getOutputStream()) {
                    WorkshopFilesPlugin.copy(input, out);
                }
                if (request.getResponseCode() == 401) accessToken = null;
                uploaded = WorkshopDriveFiles.json(request, 256 * 1024);
            } finally { request.disconnect(); }
            if (!hash.equals(uploaded.optString("sha256Checksum")) || size != uploaded.optLong("size", -1)) {
                throw new IOException("云端文件校验失败，请重新检查备份。");
            }
            return new JSObject().put("id", uploaded.getString("id"));
        });
    }

    private JSObject download(String id, String hash, long size) throws Exception {
        if (id == null || !id.matches("[A-Za-z0-9_-]{1,256}")) throw new IOException("云端文件 ID 无效。");
        String url = API + "/files/" + id + "?alt=media";
        boolean[] fromNetwork = {false};
        File file = WorkshopDriveFiles.download(getContext(), hash, size, range -> open(url, range), () -> fromNetwork[0] = true);
        return new JSObject().put("id", id).put("uri", Uri.fromFile(file).toString()).put("reused", !fromNetwork[0]);
    }

    @PluginMethod public void materialize(PluginCall call) {
        run(call, () -> WorkshopDriveFiles.materialize(getContext(), call.getString("sha256"), call.getString("kind"),
            call.getString("extension", ""), call.getString("mime", "application/octet-stream")));
    }

    @PluginMethod public void space(PluginCall call) {
        run(call, () -> {
            long needed = 0;
            int cached = 0;
            org.json.JSONArray objects = call.getArray("objects");
            for (int i = 0; i < objects.length(); i++) {
                JSONObject object = objects.getJSONObject(i);
                long remaining = WorkshopDriveFiles.remainingBytes(getContext(), object.getString("sha256"), object.getLong("size"));
                needed = Math.addExact(needed, remaining);
                if (remaining == 0) cached++;
            }
            return new JSObject().put("bytes", new StatFs(getContext().getFilesDir().getPath()).getAvailableBytes()).put("needed", needed).put("cached", cached);
        });
    }

    private JSONObject user(String token) throws Exception {
        if (token == null || token.isEmpty()) throw new IOException("未获得 Google Drive 访问权限。");
        return WorkshopDriveFiles.json(connection(API + "/about?fields=user(permissionId,emailAddress,displayName)", token, ""), 256 * 1024)
            .getJSONObject("user");
    }

    private String token() throws Exception {
        if (accessToken != null) return accessToken;
        SharedPreferences preferences = accountPreferences();
        String id = preferences.getString("id", "");
        if (id.isEmpty()) throw new IOException("请先连接 Google Drive。");
        AuthorizationResult result = Tasks.await(Identity.getAuthorizationClient(getContext())
            .authorize(request(preferences.getString("email", ""))), 30, TimeUnit.SECONDS);
        if (result.hasResolution()) throw new IOException("Google 授权已失效，请重新连接账号。");
        String renewed = result.getAccessToken();
        if (!id.equals(user(renewed).getString("permissionId"))) throw new IOException("Google 账号已切换，请重新连接。");
        accessToken = renewed;
        return accessToken;
    }

    private HttpURLConnection open(String url, String range) throws Exception {
        HttpURLConnection response = connection(url, token(), range);
        if (response.getResponseCode() != 401) return response;
        response.disconnect();
        String invalid = accessToken;
        accessToken = null;
        Tasks.await(Identity.getAuthorizationClient(getContext()).clearToken(
            ClearTokenRequest.builder().setToken(invalid).build()), 30, TimeUnit.SECONDS);
        return connection(url, token(), range);
    }

    private static HttpURLConnection connection(String url, String token, String range) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(30_000);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept-Encoding", "identity");
        if (!range.isEmpty()) connection.setRequestProperty("Range", range);
        return connection;
    }

    private interface Operation { JSObject run() throws Exception; }
    private void run(PluginCall call, Operation operation) {
        queue.execute(() -> {
            try {
                if (connecting) throw new IOException("请等待 Google 授权结束。");
                call.resolve(operation.run());
            } catch (Exception error) {
                call.reject(error instanceof IOException ? error.getMessage() : "Google Drive 操作失败，请检查网络或重新连接账号。", error);
            }
        });
    }
}
