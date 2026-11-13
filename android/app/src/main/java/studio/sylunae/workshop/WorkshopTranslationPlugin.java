package studio.sylunae.workshop;

import android.app.Dialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "WorkshopTranslation")
public class WorkshopTranslationPlugin extends Plugin {
    private static final String ALIAS = "workshop-google-translator";
    private static final String ENDPOINT = "https://translation.googleapis.com/language/translate/v2";
    private static final String LANGUAGE = "[a-zA-Z]{2,8}(-[a-zA-Z0-9]{2,8})*";

    @PluginMethod
    public void openWeb(PluginCall call) {
        String text = call.getString("text", "");
        String from = call.getString("from", "auto");
        String to = call.getString("to", "zh-CN");
        if (text.codePointCount(0, text.length()) > 5000 || !from.matches(LANGUAGE) || !to.matches(LANGUAGE)) {
            call.reject("请检查语言，网页模式最多可带入 5,000 字符。");
            return;
        }
        String url = new Uri.Builder().scheme("https").authority("translate.google.com").path("/")
                .appendQueryParameter("sl", from).appendQueryParameter("tl", to)
                .appendQueryParameter("text", text).appendQueryParameter("op", "translate").build().toString();
        getActivity().runOnUiThread(() -> {
            Dialog dialog = new Dialog(getActivity());
            LinearLayout layout = new LinearLayout(getActivity());
            layout.setOrientation(LinearLayout.VERTICAL);
            Button close = new Button(getActivity());
            close.setText("返回工坊");
            close.setOnClickListener(view -> dialog.dismiss());
            layout.addView(close);

            WebView browser = new WebView(getActivity());
            browser.getSettings().setJavaScriptEnabled(true);
            browser.getSettings().setDomStorageEnabled(true);
            browser.getSettings().setAllowFileAccess(false);
            browser.getSettings().setAllowContentAccess(false);
            browser.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri target = request.getUrl();
                    return request.isForMainFrame() && !("https".equals(target.getScheme()) && "translate.google.com".equals(target.getAuthority()));
                }
            });
            layout.addView(browser, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
            dialog.setContentView(layout);
            dialog.setOnDismissListener(ignored -> {
                layout.removeView(browser);
                browser.destroy();
            });
            dialog.show();
            dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            browser.loadUrl(url);
            call.resolve();
        });
    }

    @PluginMethod
    public void readClipboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ClipboardManager clipboard = getContext().getSystemService(ClipboardManager.class);
            ClipData data = clipboard.getPrimaryClip();
            CharSequence text = data == null || data.getItemCount() == 0 ? null : data.getItemAt(0).getText();
            call.resolve(new JSObject().put("text", text == null ? "" : text.toString()));
        });
    }

    @PluginMethod
    public void writeClipboard(PluginCall call) {
        String text = call.getString("text", "");
        getActivity().runOnUiThread(() -> {
            ClipboardManager clipboard = getContext().getSystemService(ClipboardManager.class);
            clipboard.setPrimaryClip(ClipData.newPlainText("译文", text));
            call.resolve();
        });
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(ALIAS, Context.MODE_PRIVATE);
    }

    private SecretKey secretKey(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.getKey(ALIAS, null) instanceof SecretKey existing) return existing;
        if (!create) throw new IllegalStateException();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    private synchronized JSONObject credentials() throws Exception {
        String encrypted = preferences().getString("credentials", null);
        if (encrypted == null) return null;
        String[] parts = encrypted.split(":", 2);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey(false), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
    }

    @PluginMethod
    public void status(PluginCall call) {
        try {
            call.resolve(new JSObject().put("configured", credentials() != null));
        } catch (Exception error) {
            call.reject("无法读取本机 Google Cloud API Key，请重新配置。");
        }
    }

    @PluginMethod
    public synchronized void save(PluginCall call) {
        String key = call.getString("key", "").trim();
        if (!key.matches("(?i)AIza[a-zA-Z0-9_-]{35}")) {
            call.reject("请输入有效格式的 Google Cloud API Key。");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey(true));
            String value = new JSONObject().put("key", key).toString();
            String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
                    Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!preferences().edit().putString("credentials", encrypted).commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception error) {
            call.reject("无法加密保存 Google Cloud API Key。");
        }
    }

    @PluginMethod
    public synchronized void clear(PluginCall call) {
        if (preferences().edit().remove("credentials").commit()) call.resolve();
        else call.reject("无法清除 Google Cloud API Key。");
    }

    @PluginMethod
    public void translate(PluginCall call) {
        JSONArray texts = call.getArray("texts");
        String from = call.getString("from");
        String to = call.getString("to", "");
        JSONObject body = new JSONObject();
        try {
            if (texts == null || texts.length() < 1 || texts.length() > 128 || !to.matches(LANGUAGE) ||
                    (from != null && !from.matches(LANGUAGE))) throw new IllegalArgumentException();
            int length = 0;
            for (int i = 0; i < texts.length(); i++) {
                Object value = texts.get(i);
                if (!(value instanceof String)) throw new IllegalArgumentException();
                String text = (String) value;
                length += text.codePointCount(0, text.length());
                if (text.trim().isEmpty() || length > 15000) throw new IllegalArgumentException();
            }
            body.put("q", texts).put("target", to).put("format", "text").put("model", "nmt");
            if (from != null) body.put("source", from);
        } catch (Exception error) {
            call.reject("翻译请求超出限制，或包含无效的语言。");
            return;
        }
        request(call, "", body, texts.length());
    }

    @PluginMethod
    public void languages(PluginCall call) {
        request(call, "/languages?target=zh-CN&model=nmt", null, 0);
    }

    private void request(PluginCall call, String path, JSONObject body, int size) {
        JSONObject credentials;
        try {
            credentials = credentials();
        } catch (Exception error) {
            call.reject("无法读取本机 Google Cloud API Key，请重新配置。");
            return;
        }
        if (credentials == null) {
            call.reject("请先填写自己的 Google Cloud API Key。");
            return;
        }
        java.util.concurrent.CompletableFuture.runAsync(() -> request(call, path, body, size, credentials));
    }

    private void request(PluginCall call, String path, JSONObject body, int size, JSONObject credentials) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(ENDPOINT + path).openConnection();
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(25000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("x-goog-api-key", credentials.getString("key"));
            if (body != null) {
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(payload.length);
                try (var output = connection.getOutputStream()) { output.write(payload); }
            }
            int status = connection.getResponseCode();
            if (status != 200) {
                String error = readBody(connection.getErrorStream()).toLowerCase(java.util.Locale.ROOT);
                if (status == 429 || error.matches("(?s).*(limitexceeded|quota_exceeded|rate_limit|daily limit exceeded|rate limit exceeded).*")) {
                    call.reject("已达到 Google Cloud 调用频率或用量限制，请检查项目配额。");
                } else if (status == 401 || status == 403 || error.contains("api_key_invalid")) {
                    call.reject("Google 拒绝了请求，请检查 API Key、API 限制、Cloud Translation API 和结算状态。");
                } else {
                    call.reject("Google 翻译请求失败（HTTP " + status + "）。");
                }
                return;
            }
            JSONObject data = new JSONObject(readBody(connection.getInputStream())).getJSONObject("data");
            if (body == null) {
                call.resolve(new JSObject().put("languages", data.getJSONArray("languages")));
                return;
            }
            JSONArray translations = data.getJSONArray("translations");
            if (translations.length() != size) throw new org.json.JSONException("Incomplete result");
            JSONArray segments = new JSONArray();
            for (int i = 0; i < size; i++) {
                JSONObject item = translations.getJSONObject(i);
                JSONObject segment = new JSONObject().put("text", item.getString("translatedText"));
                if (item.has("detectedSourceLanguage")) segment.put("detectedLanguage", item.getString("detectedSourceLanguage"));
                segments.put(segment);
            }
            call.resolve(new JSObject().put("segments", segments));
        } catch (org.json.JSONException error) {
            call.reject("Google 返回的结果不完整。");
        } catch (Exception error) {
            call.reject("无法连接 Google Cloud Translation，请检查网络后重试。");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String readBody(java.io.InputStream input) throws java.io.IOException {
        if (input == null) return "";
        StringBuilder response = new StringBuilder();
        try (var reader = new java.io.InputStreamReader(input, StandardCharsets.UTF_8)) {
            char[] buffer = new char[4096];
            int read;
            while ((read = reader.read(buffer)) != -1) response.append(buffer, 0, read);
        }
        return response.toString();
    }
}
