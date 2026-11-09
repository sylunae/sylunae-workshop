package studio.sylunae.workshop;

import android.app.PendingIntent;
import android.content.Intent;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/** Owns playback and the entire queue even while the WebView is suspended. */
public class WorkshopPlaybackService extends MediaSessionService {
    private MediaSession session;
    @Override public void onCreate() {
        super.onCreate();
        ExoPlayer player = new ExoPlayer.Builder(this).build();
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true);
        player.setHandleAudioBecomingNoisy(true);
        player.setWakeMode(C.WAKE_MODE_LOCAL);
        PendingIntent activity = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        session = new MediaSession.Builder(this, player).setSessionActivity(activity).build();
    }
    @androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
    @Nullable @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) {
        return controller.getPackageName().equals(getPackageName()) || controller.isTrusted() ? session : null;
    }
    @Override public void onTaskRemoved(@Nullable Intent rootIntent) {
        // Swiping the activity away does not stop active music. A paused service can stop.
        if (!session.getPlayer().getPlayWhenReady() || session.getPlayer().getMediaItemCount() == 0) stopSelf();
    }
    @Override public void onDestroy() {
        if (session != null) { session.getPlayer().release(); session.release(); session = null; }
        super.onDestroy();
    }
}
