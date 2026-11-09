package studio.sylunae.workshop;

import android.content.Context;
import android.net.Uri;
import android.util.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

/** The backup stays off the Capacitor bridge. Only one embedded attachment is decoded at a time. */
final class BackupMediaReader {
    private static final java.util.Set<String> MEDIA_FIELDS=new java.util.HashSet<>(java.util.Arrays.asList("src","image","cover","homeWallpaper","characterImage","pressSound","releaseSound","coverImagePath","coverPath","faviconUrl"));
    static File prepare(Context context,Uri uri) throws Exception {
        File output=new File(context.getCacheDir(),"backup-preview-"+UUID.randomUUID()+".json");
        try(InputStream input=context.getContentResolver().openInputStream(uri)) {
            prepare(context,input,output); return output;
        } catch(Exception|OutOfMemoryError error) { output.delete();throw error; }
    }
    static void prepare(Context context,InputStream input,File output) throws Exception {
        try(JsonReader reader=new JsonReader(new InputStreamReader(input,StandardCharsets.UTF_8));JsonWriter writer=new JsonWriter(new OutputStreamWriter(new FileOutputStream(output),StandardCharsets.UTF_8))) {
            copy(context,reader,writer,"",0);
            if(reader.peek()!=JsonToken.END_DOCUMENT)throw new IOException("备份含有无效的多余内容");
        }
    }
    private static void copy(Context context,JsonReader reader,JsonWriter writer,String field,int depth) throws Exception {
        if(depth>128)throw new IOException("备份嵌套层级过深");
        switch(reader.peek()) {
            case BEGIN_OBJECT:
                reader.beginObject();writer.beginObject();
                while(reader.hasNext()){String key=reader.nextName();writer.name(key);copy(context,reader,writer,key,depth+1);} reader.endObject();writer.endObject();break;
            case BEGIN_ARRAY:
                reader.beginArray();writer.beginArray();while(reader.hasNext())copy(context,reader,writer,field,depth+1);reader.endArray();writer.endArray();break;
            case STRING:
                String value=reader.nextString();
                if(MEDIA_FIELDS.contains(field) && (value.startsWith("data:image/") || value.startsWith("data:audio/"))) {
                    int comma=value.indexOf(',');
                    if(comma>0 && value.substring(0,comma).endsWith(";base64")) {
                        String mime=value.substring(5,comma-7);
                        byte[] bytes=Base64.decode(value.substring(comma+1),Base64.DEFAULT);
                        String hash=WorkshopFilesPlugin.hex(MessageDigest.getInstance("SHA-256").digest(bytes));
                        File asset=WorkshopFilesPlugin.privateFile(context,"note-assets/"+hash);asset.getParentFile().mkdirs();
                        if(!asset.isFile())WorkshopFilesPlugin.atomicWrite(asset,bytes);
                        WorkshopFilesPlugin.atomicWrite(new File(asset.getPath()+".mime"),mime.getBytes(StandardCharsets.UTF_8));
                        value=field.equals("src") && mime.startsWith("image/")?"sylunae-note-asset:"+hash:"/_capacitor_file_"+asset.getCanonicalPath();
                    }
                }
                writer.value(value);break;
            case NUMBER: writer.value(new java.math.BigDecimal(reader.nextString()));break;
            case BOOLEAN:writer.value(reader.nextBoolean());break;
            case NULL:reader.nextNull();writer.nullValue();break;
            default:throw new IOException("备份 JSON 格式不正确");
        }
    }
}
