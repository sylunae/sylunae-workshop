package studio.sylunae.workshop;

import android.content.ComponentName;
import android.content.Context;
import android.net.Uri;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.google.common.util.concurrent.ListenableFuture;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Device test: no screenshots or UI gestures; checks the real Media3 service. */
@RunWith(AndroidJUnit4.class)
public class BackgroundPlaybackTest {
    private void main(Runnable action) { InstrumentationRegistry.getInstrumentation().runOnMainSync(action); }
    private void shell(String command) throws Exception {
        try (android.os.ParcelFileDescriptor descriptor = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
             java.io.InputStream input = new android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor)) { while (input.read() != -1) {} }
    }
    private File wav(Context context, String name, int seconds) throws Exception {
        File file = WorkshopFilesPlugin.privateFile(context, "music/test/"+name); file.getParentFile().mkdirs();
        int frames = seconds * 16000;
        ByteBuffer bytes = ByteBuffer.allocate(44 + frames*2).order(ByteOrder.LITTLE_ENDIAN);
        bytes.put("RIFF".getBytes()).putInt(36+frames*2).put("WAVEfmt ".getBytes()).putInt(16).putShort((short)1).putShort((short)1).putInt(16000).putInt(32000).putShort((short)2).putShort((short)16).put("data".getBytes()).putInt(frames*2);
        for (int i=0;i<frames;i++) bytes.putShort((short)(Math.sin(i*2*Math.PI*440/16000)*1000));
        WorkshopFilesPlugin.atomicWrite(file, bytes.array()); return file;
    }
    @Test public void queueAdvancesInBackgroundAndNativeControlsRemainAvailable() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File first = wav(context, "first.wav", 1), second = wav(context, "second.wav", 30);
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            final ListenableFuture<MediaController>[] future = new ListenableFuture[1];
            main(() -> future[0] = new MediaController.Builder(context, new SessionToken(context, new ComponentName(context, WorkshopPlaybackService.class))).buildAsync());
            MediaController controller = future[0].get(20, TimeUnit.SECONDS);
            try {
                main(() -> {
                    controller.setMediaItems(Arrays.asList(new MediaItem.Builder().setMediaId("first").setUri(Uri.fromFile(first)).build(), new MediaItem.Builder().setMediaId("second").setUri(Uri.fromFile(second)).build()));
                    controller.setRepeatMode(Player.REPEAT_MODE_ALL); controller.prepare(); controller.play();
                });
                AtomicBoolean playing = new AtomicBoolean();
                long deadline = System.currentTimeMillis()+15000;
                do { Thread.sleep(100); main(() -> playing.set(controller.isPlaying())); } while (!playing.get() && System.currentTimeMillis()<deadline);
                assertTrue("Native service should start playing", playing.get());
                activity.moveToState(Lifecycle.State.CREATED);
                shell("input keyevent KEYCODE_SLEEP");
                assertFalse("The screen should be off", context.getSystemService(android.os.PowerManager.class).isInteractive());
                Thread.sleep(3500);
                AtomicInteger index = new AtomicInteger(); AtomicLong position = new AtomicLong();
                main(() -> { playing.set(controller.isPlaying()); index.set(controller.getCurrentMediaItemIndex()); position.set(controller.getCurrentPosition()); });
                assertTrue("Playback must continue with the activity stopped", playing.get());
                assertEquals("The service must advance without JavaScript", 1, index.get());
                assertTrue(position.get()>1000);
                main(() -> { controller.pause(); controller.seekTo(5000); });
                Thread.sleep(250);
                main(() -> { playing.set(controller.getPlayWhenReady()); position.set(controller.getCurrentPosition()); });
                assertFalse(playing.get()); assertTrue(Math.abs(position.get()-5000)<500);
                main(() -> { controller.seekToPreviousMediaItem(); index.set(controller.getCurrentMediaItemIndex()); });
                assertEquals(0, index.get());
            } finally { shell("input keyevent KEYCODE_WAKEUP"); main(() -> { controller.stop(); controller.clearMediaItems(); controller.release(); }); }
        } finally { first.delete(); second.delete(); }
    }
    @Test public void privateFilesRejectDesktopPathsAndTraversal() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        for (String path: Arrays.asList("C:\\Music\\song.mp3", "../outside", "/sdcard/music.mp3", "music/../../outside")) {
            try { WorkshopFilesPlugin.privateFile(context, path); fail("Accepted unsafe path: "+path); }
            catch (java.io.IOException expected) { }
        }
        assertTrue(WorkshopFilesPlugin.privateFile(context, "music/hash/song.mp3").getPath().startsWith(context.getFilesDir().getCanonicalPath()+File.separator));
    }
    @Test public void importedContentUriIsCopiedAndSurvivesRemovalOfTheOriginal() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File source = new File(context.getCacheDir(), "transferred-from-pc.wav");
        File generated = wav(context, "source.wav", 2);
        WorkshopFilesPlugin.atomicWrite(source, WorkshopFilesPlugin.readBytes(generated, 1024*1024)); generated.delete();
        String originalHash = WorkshopFilesPlugin.hashFile(source);
        Uri selected = androidx.core.content.FileProvider.getUriForFile(context, context.getPackageName()+".fileprovider", source);
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WorkshopFilesPlugin> files = new AtomicReference<>();
            activity.onActivity(current -> { try { files.set((WorkshopFilesPlugin) current.getBridge().getPlugin("WorkshopFiles").getInstance()); } catch (Exception error) { throw new RuntimeException(error); } });
            com.getcapacitor.JSObject first = files.get().importFile(selected, "music");
            com.getcapacitor.JSObject duplicate = files.get().importFile(selected, "music");
            assertEquals(first.getString("path"), duplicate.getString("path"));
            assertTrue(first.getString("path").startsWith("music/"+originalHash+"/"));
            assertTrue(source.delete());
            File imported = WorkshopFilesPlugin.privateFile(context, first.getString("path"));
            assertTrue(imported.isFile()); assertEquals(originalHash, WorkshopFilesPlugin.hashFile(imported)); imported.delete();
        } finally { source.delete(); }
    }
}
