package studio.sylunae.workshop;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Tests the actual WebView -> Capacitor -> SQLite/file bridge without visual assertions. */
@RunWith(AndroidJUnit4.class)
public class BridgeIntegrationTest {
    private Object evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>(); CountDownLatch completed = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); completed.countDown(); }));
        assertTrue("JavaScript evaluation timed out", completed.await(10, TimeUnit.SECONDS));
        return new JSONTokener(result.get()).nextValue();
    }
    private JSONObject await(ActivityScenario<MainActivity> scenario, String expression) throws Exception {
        evaluate(scenario, "window.__nativeTestResult=null;(async()=>{try{window.__nativeTestResult=JSON.stringify({ok:true,value:await ("+expression+")})}catch(e){window.__nativeTestResult=JSON.stringify({ok:false,error:String(e)})}})()");
        long deadline = System.currentTimeMillis()+20000;
        do {
            Thread.sleep(100); Object value = evaluate(scenario, "window.__nativeTestResult");
            if (value instanceof String) { JSONObject result = new JSONObject((String)value); assertTrue(result.toString(), result.getBoolean("ok")); return result; }
        } while (System.currentTimeMillis()<deadline);
        throw new AssertionError("Native bridge operation timed out");
    }
    @Test public void nativeStorageRollsBackInvalidPatchesAndServesPrivateFiles() throws Exception {
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            long deadline = System.currentTimeMillis()+30000;
            while (!Boolean.TRUE.equals(evaluate(activity, "Boolean(window.sylunae && document.querySelector('.app-shell'))")) && System.currentTimeMillis()<deadline) Thread.sleep(100);
            assertEquals("android", evaluate(activity, "window.sylunae?.platform"));
            String transaction = "(async()=>{const api=window.sylunae;const original=await api.storage.load();try{await api.storage.save({todos:[]});let rejected=false;try{await api.storage.save({todos:[{id:'should-rollback'}],noteChanges:{put:[{title:'missing-id'}],delete:[]}})}catch(e){rejected=true}const after=await api.storage.load();const id=await api.storage.putNoteAsset(new Uint8Array([1,2,3,4]),'image/png');const asset=await api.storage.getNoteAsset(id);return {rejected,todos:after.todos,asset:Array.from(asset.bytes),mime:asset.mime}}finally{await api.storage.replace(original)}})()";
            JSONObject value = await(activity, transaction).getJSONObject("value");
            assertTrue(value.getBoolean("rejected")); assertEquals(0, value.getJSONArray("todos").length());
            assertEquals("[1,2,3,4]", value.getJSONArray("asset").toString()); assertEquals("image/png", value.getString("mime"));
            assertTrue(await(activity, "window.Capacitor.Plugins.WorkshopDrive.status()").getJSONObject("value").getBoolean("configured"));
            File file = WorkshopFilesPlugin.privateFile(InstrumentationRegistry.getInstrumentation().getTargetContext(), "music/test/bridge.txt"); file.getParentFile().mkdirs();
            WorkshopFilesPlugin.atomicWrite(file, "private-file-roundtrip".getBytes(StandardCharsets.UTF_8));
            try {
                String read = "(async()=>{const url=await window.sylunae.music.getAudioUrl('music/test/bridge.txt');const response=await fetch(url);if(!response.ok)throw new Error('HTTP '+response.status);return response.text()})()";
                assertEquals("private-file-roundtrip", await(activity, read).getString("value"));
            } finally { file.delete(); }
            File cloudObject = WorkshopFilesPlugin.privateFile(InstrumentationRegistry.getInstrumentation().getTargetContext(), "drive-objects/bridge-test");
            cloudObject.getParentFile().mkdirs();
            WorkshopFilesPlugin.atomicWrite(cloudObject, "{\"test\":\"云端数据\"}".getBytes(StandardCharsets.UTF_8));
            try {
                String readCloud = "(async()=>{const url=await window.sylunae.music.getAudioUrl('drive-objects/bridge-test');return (await (await fetch(url)).json()).test})()";
                assertEquals("云端数据", await(activity, readCloud).getString("value"));
            } finally { cloudObject.delete(); }
            File audio = WorkshopFilesPlugin.privateFile(InstrumentationRegistry.getInstrumentation().getTargetContext(), "music/test/controls.opus");
            try (java.io.InputStream input = InstrumentationRegistry.getInstrumentation().getTargetContext().getAssets().open("public/resources/white-noise/audio/window-rain.opus"); java.io.OutputStream output = new java.io.FileOutputStream(audio)) { WorkshopFilesPlugin.copy(input, output); }
            try {
                String controls = "(async()=>{const p=window.Capacitor.Plugins.WorkshopPlayer;const tracks=['one','two'].map(id=>({id,path:'music/test/controls.opus',title:id,artist:'Test',album:'Test'}));await p.command({op:'modes',repeat:'off',shuffle:false});await p.command({op:'queue',tracks,id:'two',play:false});const next=await p.command({op:'next'});await p.command({op:'pause'});const previous=await p.command({op:'previous'});await p.command({op:'stop'});return {next:next.id,previous:previous.id}})()";
                JSONObject controlled = await(activity, controls).getJSONObject("value");
                assertEquals("one", controlled.getString("next")); assertEquals("two", controlled.getString("previous"));
            } finally { audio.delete(); }
        }
    }
}
