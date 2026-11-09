package studio.sylunae.workshop;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name = "WorkshopUpdates")
public class WorkshopUpdatesPlugin extends Plugin {
    private static final String REPOSITORY = "sylunae/sylunae-workshop";
    private static final String RELEASES = "https://api.github.com/repos/" + REPOSITORY + "/releases";
    private static final Pattern TAG = Pattern.compile("android-v(0|[1-9][0-9]{0,3})\\.(0|[1-9][0-9]{0,2})\\.(0|[1-9][0-9]{0,2})");
    private static final Pattern DIGEST = Pattern.compile("sha256:[a-f0-9]{64}");
    private static final long MAX_APK_SIZE = 512L * 1024 * 1024;
    private final ExecutorService queue = Executors.newSingleThreadExecutor();
    private Release available;
    private File prepared;

    private record Release(String tag, String version, int code, String name, byte[] hash, long size) {}

    @Override protected void handleOnDestroy() {
        queue.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod public void check(PluginCall call) {
        queue.execute(() -> {
            try {
                if (getContext().getPackageName().endsWith(".debug")) {
                    call.resolve(new JSObject().put("status", "disabled"));
                    return;
                }
                int current = installedPackage(0).versionCode;
                available = findRelease(current);
                JSObject result = new JSObject();
                result.put("status", available == null ? "current" : "available");
                if (available != null) {
                    result.put("version", available.version);
                    result.put("size", available.size);
                }
                call.resolve(result);
            } catch (Exception error) {
                call.reject("无法检查更新，请稍后重试。", error);
            }
        });
    }

    @PluginMethod public void prepare(PluginCall call) {
        queue.execute(() -> {
            try {
                Release release = available;
                if (release == null) throw new IOException("No update selected");
                if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    launch(call, new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName())), "permission");
                    return;
                }
                if (prepared == null || !prepared.isFile() || !prepared.getName().equals(release.name)) {
                    prepared = download(release);
                }
                call.resolve(new JSObject().put("status", "ready"));
            } catch (Exception error) {
                call.reject("无法下载或验证更新，请稍后重试。", error);
            }
        });
    }

    @PluginMethod public void install(PluginCall call) {
        queue.execute(() -> {
            if (available == null || prepared == null || !prepared.isFile() || !prepared.getName().equals(available.name)) {
                call.reject("更新尚未准备好，请重新下载。");
                return;
            }
            try {
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", prepared);
                launch(call, new Intent(Intent.ACTION_INSTALL_PACKAGE, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "installer");
            } catch (RuntimeException error) {
                call.reject("无法打开 Android 安装界面。", error);
            }
        });
    }

    private void launch(PluginCall call, Intent intent, String status) {
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(intent);
                call.resolve(new JSObject().put("status", status));
            } catch (RuntimeException error) {
                call.reject("无法打开 Android 安装界面。", error);
            }
        });
    }

    private PackageInfo installedPackage(int flags) throws PackageManager.NameNotFoundException {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), flags);
    }

    private static Release findRelease(int currentCode) throws Exception {
        Release newest = null;
        for (int page = 1; ; page++) {
            HttpsURLConnection connection = open(RELEASES + "?per_page=100&page=" + page);
            JSONArray releases;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream body = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                for (int count; (count = input.read(buffer)) != -1; ) {
                    if (body.size() + count > 16 * 1024 * 1024) throw new IOException("Release list too large");
                    body.write(buffer, 0, count);
                }
                releases = new JSONArray(new String(body.toByteArray(), StandardCharsets.UTF_8));
            } finally {
                connection.disconnect();
            }
            for (int i = 0; i < releases.length(); i++) {
                Release candidate = readRelease(releases.getJSONObject(i));
                if (candidate != null && candidate.code > (newest == null ? currentCode : newest.code)) newest = candidate;
            }
            if (releases.length() < 100) return newest;
        }
    }

    private static Release readRelease(JSONObject release) throws Exception {
        if (release.optBoolean("draft") || release.optBoolean("prerelease")) return null;
        String tag = release.optString("tag_name");
        var match = TAG.matcher(tag);
        if (!match.matches()) return null;
        int major = Integer.parseInt(match.group(1));
        if (major >= 2100) return null;
        int code = major * 1_000_000 + Integer.parseInt(match.group(2)) * 1_000 + Integer.parseInt(match.group(3));
        String version = tag.substring("android-v".length());
        String name = "Sylunae-Workshop-" + version + "-Android.apk";
        JSONArray assets = release.getJSONArray("assets");
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            String digest = asset.optString("digest");
            long size = asset.optLong("size");
            if (name.equals(asset.optString("name")) && "uploaded".equals(asset.optString("state"))
                && DIGEST.matcher(digest).matches() && size > 0 && size <= MAX_APK_SIZE) {
                byte[] hash = new byte[32];
                for (int j = 0; j < hash.length; j++) hash[j] = (byte) Integer.parseInt(digest.substring(7 + j * 2, 9 + j * 2), 16);
                return new Release(tag, version, code, name, hash, size);
            }
        }
        return null;
    }

    @SuppressWarnings("deprecation")
    private File download(Release release) throws Exception {
        File directory = new File(getContext().getCacheDir(), "updates");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create update cache");
        File pending = File.createTempFile("update-", ".apk", directory);
        HttpsURLConnection connection = null;
        try {
            connection = open("https://github.com/" + REPOSITORY + "/releases/download/" + release.tag + "/" + release.name);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long received = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(pending)) {
                byte[] buffer = new byte[64 * 1024];
                for (int count; (count = input.read(buffer)) != -1; ) {
                    received += count;
                    if (received > release.size) throw new IOException("APK exceeds expected size");
                    digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                }
            }
            if (received != release.size || !MessageDigest.isEqual(release.hash, digest.digest())) {
                throw new IOException("APK checksum mismatch");
            }
            PackageInfo archive = getContext().getPackageManager().getPackageArchiveInfo(pending.getAbsolutePath(), PackageManager.GET_SIGNATURES);
            PackageInfo installed = installedPackage(PackageManager.GET_SIGNATURES);
            if (archive == null || !installed.packageName.equals(archive.packageName) || archive.versionCode != release.code
                || archive.versionCode <= installed.versionCode || installed.signatures == null
                || !Arrays.equals(installed.signatures, archive.signatures)) {
                throw new IOException("APK does not match the installed app or signing certificate");
            }
            File destination = new File(directory, release.name);
            if (!pending.renameTo(destination)) throw new IOException("Cannot save verified APK");
            if (prepared != null && !prepared.equals(destination)) prepared.delete();
            return destination;
        } finally {
            if (connection != null) connection.disconnect();
            pending.delete();
        }
    }

    private static HttpsURLConnection open(String address) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setRequestProperty("User-Agent", "Sylunae-Workshop-Android");
        return connection;
    }
}
