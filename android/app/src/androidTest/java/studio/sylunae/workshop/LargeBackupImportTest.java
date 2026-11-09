package studio.sylunae.workshop;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.io.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class LargeBackupImportTest {
    @Test public void largeLegacyBackupRowsSurviveImportAndReload() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WorkshopFilesPlugin> reference = new AtomicReference<>();
            activity.onActivity(current -> { try { reference.set((WorkshopFilesPlugin)current.getBridge().getPlugin("WorkshopFiles").getInstance()); } catch(Exception error) { throw new RuntimeException(error); } });
            Method save = WorkshopFilesPlugin.class.getDeclaredMethod("saveSnapshot", JSONObject.class, boolean.class); save.setAccessible(true);
            Method load = WorkshopFilesPlugin.class.getDeclaredMethod("loadSnapshot"); load.setAccessible(true);
            WorkshopFilesPlugin plugin = reference.get(); JSObject original = (JSObject)load.invoke(plugin);
            StringBuilder text = new StringBuilder(); for (int i=0;i<3*1024*1024;i++) text.append('x');
            JSONObject imported = new JSONObject().put("settings", new JSONObject().put("homeWallpaper", text.toString())).put("notes", new JSONArray().put(new JSONObject().put("id", "large-note").put("title", "Long note").put("content", text.toString())));
            try {
                save.invoke(plugin, imported, true);
                JSObject reloaded = (JSObject)load.invoke(plugin);
                assertEquals(text.length(), reloaded.getJSONObject("settings").getString("homeWallpaper").length());
                assertEquals(text.length(), reloaded.getJSONArray("notes").getJSONObject(0).getString("content").length());
                try(SQLiteDatabase legacy=context.openOrCreateDatabase("workshop-v1.db",0,null)) {
                    android.content.ContentValues row=new android.content.ContentValues();row.put("value",imported.getJSONObject("settings").toString());legacy.update("records",row,"id=?",new String[]{"settings"});
                }
                assertEquals(text.length(),((JSObject)load.invoke(plugin)).getJSONObject("settings").getString("homeWallpaper").length());
            } finally { save.invoke(plugin, original, true); }
        }
    }
    private Object evaluate(ActivityScenario<MainActivity> activity,String script) throws Exception {
        AtomicReference<String> result=new AtomicReference<>();CountDownLatch ready=new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            for(android.app.Activity current:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED)) {
                if(current instanceof MainActivity){((MainActivity)current).getBridge().getWebView().evaluateJavascript(script,value->{result.set(value);ready.countDown();});return;}
            }
            ready.countDown();
        });
        assertTrue(ready.await(15,TimeUnit.SECONDS));return result.get()==null?JSONObject.NULL:new JSONTokener(result.get()).nextValue();
    }
    private Object await(ActivityScenario<MainActivity> activity,String expression) throws Exception {
        evaluate(activity,"window.__largeTest=null;(async()=>{try{window.__largeTest=JSON.stringify({ok:true,value:await ("+expression+")})}catch(e){window.__largeTest=JSON.stringify({ok:false,error:String(e)})}})()");
        long deadline=System.currentTimeMillis()+90000;
        do { Thread.sleep(100);Object value=evaluate(activity,"window.__largeTest");if(value instanceof String){JSONObject result=new JSONObject((String)value);assertTrue(result.toString(),result.getBoolean("ok"));return result.opt("value");} }while(System.currentTimeMillis()<deadline);
        throw new AssertionError("Large import operation timed out");
    }
    @Test public void ninetyFiveMegabyteFullBackupImportsThroughTheRealConfirmationFlow() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        File source=new File(context.getCacheDir(),"95mb-backup.json"),prepared=new File(context.getCacheDir(),"95mb-prepared.json");
        try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)) {
            long deadline=System.currentTimeMillis()+30000;
            while(!Boolean.TRUE.equals(evaluate(activity,"Boolean(window.sylunae && document.querySelector('.app-shell'))")) && System.currentTimeMillis()<deadline)Thread.sleep(100);
            JSONObject snapshot=(JSONObject)await(activity,"window.sylunae.storage.load()");
            snapshot.getJSONObject("settings").put("displayName","95MB import verified");
            JSONArray wallpapers=new JSONArray();for(int i=0;i<5;i++)wallpapers.put(new JSONObject().put("id","wallpaper-"+i).put("title","Wallpaper").put("description","").put("image","LARGE_DATA_PLACEHOLDER"));
            snapshot.getJSONObject("settings").put("homeWallpapers",wallpapers).put("homeWallpaper","");
            String envelope=new JSONObject().put("format","siyue-workshop-backup").put("version",1).put("exportedAt","2026-11-03T00:00:00.000Z").put("snapshot",snapshot).toString();
            String[] segments=envelope.split("LARGE_DATA_PLACEHOLDER",-1);
            char[] padding=new char[8192];java.util.Arrays.fill(padding,'A');
            String png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhmcAAAAASUVORK5CYII";
            try(Writer writer=new BufferedWriter(new FileWriter(source))){
                for(int i=0;i<segments.length;i++){writer.write(segments[i]);if(i<segments.length-1){writer.write("data:image/png;base64,");writer.write(png);int left=19_000_000-png.length()-1;while(left>0){int count=Math.min(left,padding.length);writer.write(padding,0,count);left-=count;}writer.write('A'+i);}}
            }
            assertTrue(source.length()>=95_000_000);
            try(InputStream input=new FileInputStream(source)){BackupMediaReader.prepare(context,input,prepared);}
            android.util.Log.i("LargeBackupTest","95 MB media preprocessing completed");
            assertTrue("Embedded attachments should not cross the JS bridge",prepared.length()<100_000);
            String url="/_capacitor_file_"+prepared.getCanonicalPath();
            evaluate(activity,"window.sylunae.backup.importFile=async()=>{const r=await fetch("+JSONObject.quote(url)+");return r.text()};document.querySelector('.sidebar button[aria-label=\"设置\"]').click()");
            await(activity,"(async()=>{for(let i=0;i<100&&!document.querySelector('.settings-nav');i++)await new Promise(r=>setTimeout(r,50));[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.includes('数据与备份')).click();return true})()");
            await(activity,"(async()=>{for(let i=0;i<100&&!document.querySelector('.settings-actions');i++)await new Promise(r=>setTimeout(r,50));[...document.querySelectorAll('.settings-actions button')].find(b=>b.textContent.includes('导入完整备份')).click();for(let i=0;i<300&&!document.querySelector('[role=alertdialog]');i++)await new Promise(r=>setTimeout(r,50));const button=[...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent.includes('覆盖并导入'));if(!button)throw new Error('Import confirmation did not appear');button.click();for(let i=0;i<600&&document.querySelector('[role=alertdialog]');i++)await new Promise(r=>setTimeout(r,50));if(document.querySelector('[role=alertdialog]'))throw new Error(document.querySelector('[role=alertdialog]').textContent);return true})()");
            JSONObject saved=(JSONObject)await(activity,"window.sylunae.storage.load()");
            android.util.Log.i("LargeBackupTest","Full backup confirmation committed");
            assertEquals("95MB import verified",saved.getJSONObject("settings").getString("displayName"));
            assertEquals(5,saved.getJSONObject("settings").getJSONArray("homeWallpapers").length());
            assertTrue(saved.getJSONObject("settings").getJSONArray("homeWallpapers").getJSONObject(0).getString("image").startsWith("/_capacitor_file_"));
            evaluate(activity,"document.querySelector('.settings-overlay-close')?.click()");
            Thread.sleep(1000);
            activity.recreate();
            deadline=System.currentTimeMillis()+30000;
            while(!Boolean.TRUE.equals(evaluate(activity,"Boolean(window.sylunae && document.querySelector('.app-shell'))")) && System.currentTimeMillis()<deadline)Thread.sleep(100);
            assertEquals("95MB import verified",((JSONObject)await(activity,"(async()=>{while(!window.sylunae)await new Promise(r=>setTimeout(r,50));return window.sylunae.storage.load()})()")).getJSONObject("settings").getString("displayName"));
        }finally{source.delete();prepared.delete();}
    }
}
