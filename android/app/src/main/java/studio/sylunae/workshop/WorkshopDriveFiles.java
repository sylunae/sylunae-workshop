package studio.sylunae.workshop;

import android.content.Context;
import android.net.Uri;
import android.system.ErrnoException;
import android.system.Os;
import com.getcapacitor.JSObject;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

final class WorkshopDriveFiles {
    interface OpenDownload { HttpURLConnection open(String range) throws Exception; }

    static JSONObject json(HttpURLConnection connection, int limit) throws Exception {
        try {
            requireSuccess(connection);
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                transfer(input, output, limit);
                return new JSONObject(output.toString("UTF-8"));
            }
        } finally { connection.disconnect(); }
    }

    static File download(Context context, String hash, long size, OpenDownload request) throws Exception {
        return download(context, hash, size, request, () -> {});
    }

    static File download(Context context, String hash, long size, OpenDownload request, Runnable onNetwork) throws Exception {
        validateHash(hash);
        if (size < 0) throw new IOException("云端文件大小无效。");
        File result = WorkshopFilesPlugin.privateFile(context, "drive-objects/" + hash);
        if (matches(result, hash, size)) return result;
        ensureParent(result);
        File partial = new File(result.getPath() + ".part");
        long offset = partial.length();
        if (offset >= size) {
            if (matches(partial, hash, size)) { commit(partial, result); return result; }
            offset = 0;
        }
        onNetwork.run();
        HttpURLConnection connection = request.open(offset == 0 ? "" : "bytes=" + offset + "-");
        try {
            requireSuccess(connection);
            boolean resume = connection.getResponseCode() == 206;
            if (resume && !("bytes " + offset + "-" + (size - 1) + "/" + size).equals(connection.getHeaderField("Content-Range"))) {
                throw new IOException("Google Drive 返回了不匹配的续传范围。");
            }
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial, resume)) {
                transfer(input, output, size - (resume ? offset : 0));
                output.getFD().sync();
            }
        } finally { connection.disconnect(); }
        if (partial.length() < size) throw new IOException("下载中断，请重试以继续下载。");
        if (!matches(partial, hash, size)) {
            partial.delete();
            throw new IOException("云端文件校验失败，请重新下载。");
        }
        commit(partial, result);
        return result;
    }

    static long remainingBytes(Context context, String hash, long size) throws Exception {
        validateHash(hash);
        if (size < 0) throw new IOException("云端文件大小无效。");
        File complete = WorkshopFilesPlugin.privateFile(context, "drive-objects/" + hash);
        if (complete.isFile() && complete.length() == size) return 0;
        long partial = new File(complete.getPath() + ".part").length();
        return partial < size ? size - partial : size;
    }

    static JSObject materialize(Context context, String hash, String kind, String extension, String mime) throws Exception {
        validateHash(hash);
        if (extension == null || !extension.matches("(\\.[a-z0-9]{1,10})?")) throw new IOException("无效的媒体扩展名。");
        boolean note = "note".equals(kind);
        if (!note && !"path".equals(kind) && !"inline".equals(kind)) throw new IOException("无效的媒体类型。");
        if (note && (mime == null || !mime.matches("image/[a-zA-Z0-9.+-]+"))) throw new IOException("无效的笔记图片类型。");
        File source = WorkshopFilesPlugin.privateFile(context, "drive-objects/" + hash);
        if (!source.isFile()) throw new IOException("备份媒体尚未下载。");
        String path = note ? "note-assets/" + hash : "drive-media/" + hash + extension;
        File destination = WorkshopFilesPlugin.privateFile(context, path);
        ensureParent(destination);
        if (!matches(destination, hash, source.length())) {
            File temporary = File.createTempFile("drive-", ".part", destination.getParentFile());
            try {
                if (!temporary.delete()) throw new IOException("无法准备媒体暂存文件。");
                try { Os.link(source.getPath(), temporary.getPath()); }
                catch (ErrnoException error) {
                    try (FileInputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(temporary)) {
                        transfer(input, output, source.length());
                        output.getFD().sync();
                    }
                }
                commit(temporary, destination);
            } finally { temporary.delete(); }
        }
        if (note) {
            File metadata = new File(destination.getPath() + ".mime");
            File temporary = File.createTempFile("drive-", ".mime", destination.getParentFile());
            try {
                try (FileOutputStream output = new FileOutputStream(temporary)) {
                    output.write(mime.getBytes(StandardCharsets.UTF_8));
                    output.getFD().sync();
                }
                commit(temporary, metadata);
            } finally { temporary.delete(); }
        }
        return new JSObject().put("path", path).put("uri", Uri.fromFile(destination).toString());
    }

    private static void validateHash(String hash) throws IOException {
        if (hash == null || !hash.matches("[a-f0-9]{64}")) throw new IOException("云端文件摘要无效。");
    }

    private static void ensureParent(File file) throws IOException {
        File parent = file.getParentFile();
        if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("无法创建应用私有目录。");
    }

    private static void commit(File source, File destination) throws IOException {
        if (!source.renameTo(destination)) throw new IOException("无法提交已校验的文件。");
    }

    private static boolean matches(File file, String hash, long size) throws Exception {
        if (!file.isFile() || file.length() != size) return false;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[128 * 1024];
            for (int count; (count = input.read(buffer)) != -1; ) digest.update(buffer, 0, count);
        }
        StringBuilder hex = new StringBuilder(64);
        for (byte value : digest.digest()) {
            hex.append(Character.forDigit((value & 255) >>> 4, 16));
            hex.append(Character.forDigit(value & 15, 16));
        }
        return hash.contentEquals(hex);
    }

    private static void transfer(InputStream input, java.io.OutputStream output, long limit) throws IOException {
        byte[] buffer = new byte[128 * 1024];
        long received = 0;
        for (int count; (count = input.read(buffer)) != -1; ) {
            received += count;
            if (received > limit) throw new IOException("下载大小超过预期。");
            output.write(buffer, 0, count);
        }
    }

    private static void requireSuccess(HttpURLConnection connection) throws IOException {
        int status = connection.getResponseCode();
        if (status == 200 || status == 206) return;
        if (status == 401) throw new IOException("Google 授权已失效，请重新连接账号。");
        if (status == 404) throw new IOException("云端备份文件已被删除或当前账号无权读取。");
        throw new IOException("Google Drive 请求失败（HTTP " + status + "），请检查网络和 Drive API 配置。");
    }
}
