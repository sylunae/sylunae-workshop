package studio.sylunae.workshop;

import android.accounts.Account;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.StatFs;
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
import org.json.JSONObject;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
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
            Uri url = Uri.parse(API + "/files").buildUpon()
                .appendQueryParameter("spaces", "appDataFolder")
                .appendQueryParameter("q", "trashed = false and appProperties has { key='sylunae' and value='manifest-v1' }")
                .appendQueryParameter("orderBy", "createdTime desc")
                .appendQueryParameter("pageSize", "1")
                .appendQueryParameter("fields", "nextPageToken,files(id,size,sha256Checksum)").build();
            String pageToken = "";
            do {
                Uri page = pageToken.isEmpty() ? url : url.buildUpon().appendQueryParameter("pageToken", pageToken).build();
                JSONObject listing = WorkshopDriveFiles.json(open(page.toString(), ""), 256 * 1024);
                JSONObject file = listing.getJSONArray("files").optJSONObject(0);
                if (file != null) {
                    long size = file.getLong("size");
                    if (size > 16 * 1024 * 1024) throw new IOException("云端备份清单过大。");
                    return download(file.getString("id"), file.getString("sha256Checksum"), size);
                }
                pageToken = listing.optString("nextPageToken");
            } while (!pageToken.isEmpty());
            return new JSObject().put("id", JSONObject.NULL);
        });
    }

    @PluginMethod public void download(PluginCall call) {
        run(call, () -> download(call.getString("id"), call.getString("sha256"), call.getData().getLong("size")));
    }

    private JSObject download(String id, String hash, long size) throws Exception {
        if (id == null || !id.matches("[A-Za-z0-9_-]{1,256}")) throw new IOException("云端文件 ID 无效。");
        String url = API + "/files/" + id + "?alt=media";
        return new JSObject().put("id", id).put("uri", Uri.fromFile(
            WorkshopDriveFiles.download(getContext(), hash, size, range -> open(url, range))).toString());
    }

    @PluginMethod public void materialize(PluginCall call) {
        run(call, () -> WorkshopDriveFiles.materialize(getContext(), call.getString("sha256"), call.getString("kind"),
            call.getString("extension", ""), call.getString("mime", "application/octet-stream")));
    }

    @PluginMethod public void space(PluginCall call) {
        run(call, () -> {
            long needed = 0;
            org.json.JSONArray objects = call.getArray("objects");
            for (int i = 0; i < objects.length(); i++) {
                JSONObject object = objects.getJSONObject(i);
                needed = Math.addExact(needed, WorkshopDriveFiles.remainingBytes(getContext(), object.getString("sha256"), object.getLong("size")));
            }
            return new JSObject().put("bytes", new StatFs(getContext().getFilesDir().getPath()).getAvailableBytes()).put("needed", needed);
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
