package studio.sylunae.workshop;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import androidx.media3.common.*;
import androidx.media3.session.*;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import org.json.*;
import java.util.*;

@CapacitorPlugin(name = "WorkshopPlayer")
public class WorkshopPlayerPlugin extends Plugin {
    private ListenableFuture<MediaController> connection;
    private MediaController controller;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean foreground = true;
    private final Runnable tick = new Runnable() {
        @Override public void run() { if (foreground) { publish(); handler.postDelayed(this, 500); } }
    };
    @Override public void load() {
        SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), WorkshopPlaybackService.class));
        connection = new MediaController.Builder(getContext(), token).buildAsync();
        connection.addListener(() -> {
            try {
                controller = connection.get();
                controller.addListener(new Player.Listener() {
                    @Override public void onEvents(Player player, Player.Events events) { publish(); }
                    @Override public void onPlayerError(PlaybackException error) { notifyListeners("playbackError", new JSObject().put("message", "音频无法播放: "+error.getErrorCodeName())); }
                });
                handler.removeCallbacks(tick); handler.post(tick);
            } catch (Exception ignored) { /* Commands report connection failures to the UI. */ }
        }, ContextCompat.getMainExecutor(getContext()));
    }
    private JSObject state() {
        JSObject state = new JSObject(); if (controller == null) return state;
        MediaItem item = controller.getCurrentMediaItem(); long duration = controller.getDuration();
        return state.put("id", item == null ? JSONObject.NULL : item.mediaId)
            .put("playing", controller.getPlayWhenReady() && controller.getPlaybackState() != Player.STATE_ENDED && controller.getPlaybackState() != Player.STATE_IDLE)
            .put("position", controller.getCurrentPosition()/1000.0).put("duration", duration == C.TIME_UNSET ? 0 : duration/1000.0)
            .put("volume", controller.getVolume()).put("shuffle", controller.getShuffleModeEnabled())
            .put("repeat", controller.getRepeatMode() == Player.REPEAT_MODE_ONE ? "one" : controller.getRepeatMode() == Player.REPEAT_MODE_ALL ? "all" : "off");
    }
    private void publish() { if (foreground && controller != null) notifyListeners("state", state()); }
    @PluginMethod public void command(PluginCall call) {
        connection.addListener(() -> {
            try {
                controller = connection.get(); String op = call.getString("op", "state");
                switch (op) {
                    case "queue": {
                        JSONArray queue = call.getArray("tracks"); ArrayList<MediaItem> items = new ArrayList<>();
                        for (int i=0;i<queue.length();i++) {
                            JSONObject track = queue.getJSONObject(i); String path = track.getString("path");
                            Uri uri = Uri.fromFile(WorkshopFilesPlugin.privateFile(getContext(), path));
                            MediaMetadata.Builder metadata = new MediaMetadata.Builder().setTitle(track.optString("title")).setArtist(track.optString("artist")).setAlbumTitle(track.optString("album"));
                            String cover = track.optString("cover", "");
                            if (cover.startsWith("data:image/") && cover.contains(",")) metadata.setArtworkData(android.util.Base64.decode(cover.substring(cover.indexOf(',')+1), android.util.Base64.DEFAULT), MediaMetadata.PICTURE_TYPE_FRONT_COVER);
                            else if (cover.startsWith("file://")) metadata.setArtworkUri(Uri.parse(cover));
                            else if (cover.startsWith("/_capacitor_file_")) {
                                java.io.File artwork=new java.io.File(cover.substring("/_capacitor_file_".length())).getCanonicalFile();
                                if(artwork.getPath().startsWith(getContext().getFilesDir().getCanonicalPath()+java.io.File.separator))metadata.setArtworkUri(Uri.fromFile(artwork));
                            }
                            items.add(new MediaItem.Builder().setMediaId(track.getString("id")).setUri(uri).setMediaMetadata(metadata.build()).build());
                        }
                        String selected = call.getString("id", ""); int index = 0;
                        for (int i=0;i<items.size();i++) if (items.get(i).mediaId.equals(selected)) index = i;
                        boolean same = controller.getCurrentMediaItem() != null && controller.getCurrentMediaItem().mediaId.equals(selected);
                        long position = same ? controller.getCurrentPosition() : 0;
                        if (items.isEmpty()) controller.clearMediaItems();
                        else { controller.setMediaItems(items, index, position); controller.prepare(); }
                        if (call.getBoolean("play", false)) controller.play();
                        break;
                    }
                    case "play": if (controller.getPlaybackState() == Player.STATE_ENDED) controller.seekTo(0); controller.play(); break;
                    case "pause": controller.pause(); break;
                    case "stop": controller.stop(); controller.clearMediaItems(); break;
                    case "next":
                        if (controller.getMediaItemCount() > 0) { if (controller.hasNextMediaItem()) controller.seekToNextMediaItem(); else controller.seekTo(0, 0); controller.play(); }
                        break;
                    case "previous":
                        if (controller.getMediaItemCount() > 0) { if (controller.hasPreviousMediaItem()) controller.seekToPreviousMediaItem(); else controller.seekTo(controller.getMediaItemCount()-1, 0); controller.play(); }
                        break;
                    case "seek": controller.seekTo(Math.max(0, (long)(call.getDouble("position", 0.0)*1000))); break;
                    case "volume": controller.setVolume(Math.max(0, Math.min(1, call.getFloat("volume", 1.0f)))); break;
                    case "modes": {
                        controller.setShuffleModeEnabled(call.getBoolean("shuffle", false)); String mode = call.getString("repeat", "off");
                        controller.setRepeatMode(mode.equals("one") ? Player.REPEAT_MODE_ONE : mode.equals("all") ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF); break;
                    }
                    case "state": break;
                    default: throw new IllegalArgumentException("未知的播放操作");
                }
                call.resolve(state()); publish();
            } catch (Exception error) { call.reject("播放器操作失败: "+error.getMessage(), error); }
        }, ContextCompat.getMainExecutor(getContext()));
    }
    @Override protected void handleOnPause() { foreground = false; handler.removeCallbacks(tick); }
    @Override protected void handleOnResume() { foreground = true; handler.removeCallbacks(tick); handler.post(tick); }
    @Override protected void handleOnDestroy() { handler.removeCallbacksAndMessages(null); if (connection != null) MediaController.releaseFuture(connection); }
}
