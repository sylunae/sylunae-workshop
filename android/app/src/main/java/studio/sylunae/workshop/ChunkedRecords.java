package studio.sylunae.workshop;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Small SQLite cells avoid CursorWindow limits, including when upgrading legacy large rows. */
final class ChunkedRecords {
    static final int CHUNK = 128 * 1024;
    private static final String MARKER = "@sylunae-chunks:v1";
    static void initialize(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS record_chunks (scope TEXT,id TEXT,part INTEGER,payload BLOB NOT NULL,PRIMARY KEY(scope,id,part))");
        db.execSQL("CREATE TABLE IF NOT EXISTS import_chunks (token TEXT,scope TEXT,id TEXT,part INTEGER,payload BLOB NOT NULL,created INTEGER,PRIMARY KEY(token,scope,id,part))");
        db.execSQL("CREATE TABLE IF NOT EXISTS drive_rollback_rows (scope TEXT,id TEXT,value TEXT NOT NULL,PRIMARY KEY(scope,id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS drive_rollback_chunks (scope TEXT,id TEXT,part INTEGER,payload BLOB NOT NULL,PRIMARY KEY(scope,id,part))");
        db.delete("import_chunks", "created<?", new String[]{Long.toString(System.currentTimeMillis()-86400000)});
    }
    static void validateScope(String scope) { if (!scope.equals("records") && !scope.equals("notes")) throw new IllegalArgumentException("无效的数据域"); }
    static void put(SQLiteDatabase db, String scope, String id, Object value) {
        validateScope(scope); byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        boolean own = !db.inTransaction(); if (own) db.beginTransaction();
        try {
            db.delete("record_chunks", "scope=? AND id=?", new String[]{scope,id});
            ContentValues row = new ContentValues(); row.put("id", id); row.put("value", bytes.length > CHUNK ? MARKER : value.toString());
            db.insertOrThrow(scope, null, replaceRow(db,scope,id,row));
            if (bytes.length > CHUNK) for (int start=0, part=0;start<bytes.length;start+=CHUNK,part++) {
                ContentValues chunk = new ContentValues(); chunk.put("scope",scope); chunk.put("id",id); chunk.put("part",part); chunk.put("payload",Arrays.copyOfRange(bytes,start,Math.min(start+CHUNK,bytes.length)));
                db.insertOrThrow("record_chunks",null,chunk);
            }
            if (own) db.setTransactionSuccessful();
        } finally { if (own) db.endTransaction(); }
    }
    private static ContentValues replaceRow(SQLiteDatabase db,String scope,String id,ContentValues row) { db.delete(scope,"id=?",new String[]{id}); return row; }
    static byte[] chunk(SQLiteDatabase db, String scope, String id, int part) {
        validateScope(scope); if (part<0) throw new IllegalArgumentException("无效的数据分块");
        String prefix;
        try (Cursor row=db.rawQuery("SELECT substr(value,1,32) FROM "+scope+" WHERE id=?",new String[]{id})) { if (!row.moveToFirst()) return null; prefix=row.getString(0); }
        if (MARKER.equals(prefix)) {
            try (Cursor row=db.rawQuery("SELECT payload FROM record_chunks WHERE scope=? AND id=? AND part=?",new String[]{scope,id,Integer.toString(part)})) { return row.moveToFirst()?row.getBlob(0):null; }
        }
        // substr on BLOB measures bytes and never puts a complete legacy row in CursorWindow.
        try (Cursor row=db.rawQuery("SELECT substr(CAST(value AS BLOB),?,?) FROM "+scope+" WHERE id=?",new String[]{Long.toString((long)part*CHUNK+1),Integer.toString(CHUNK),id})) {
            if (!row.moveToFirst()) return null; byte[] bytes=row.getBlob(0); return bytes.length==0?null:bytes;
        }
    }
    static Object get(SQLiteDatabase db,String scope,String id) throws JSONException,IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        for(int part=0;;part++) { byte[] bytes=chunk(db,scope,id,part); if(bytes==null)break; out.write(bytes); }
        return out.size()==0?JSONObject.NULL:new JSONTokener(out.toString("UTF-8")).nextValue();
    }
    static void delete(SQLiteDatabase db,String scope,String id) { validateScope(scope); db.delete(scope,"id=?",new String[]{id}); db.delete("record_chunks","scope=? AND id=?",new String[]{scope,id}); }
    static void clear(SQLiteDatabase db,String scope) {
        validateScope(scope); String where=scope.equals("records")?"id NOT LIKE 'resource:%'":null;
        db.delete(scope,where,null); db.delete("record_chunks", "scope=?"+(scope.equals("records")?" AND id NOT LIKE 'resource:%'":""),new String[]{scope});
    }
    static void stage(SQLiteDatabase db,String token,String scope,String id,int part,byte[] bytes) {
        validateScope(scope); if(id==null || !token.matches("[a-f0-9-]{36}") || part<0 || bytes.length>CHUNK)throw new IllegalArgumentException("无效的导入分块");
        if(scope.equals("records") && id.startsWith("resource:"))throw new IllegalArgumentException("无效的数据域");
        ContentValues row=new ContentValues(); row.put("token",token); row.put("scope",scope);row.put("id",id);row.put("part",part);row.put("payload",bytes);row.put("created",System.currentTimeMillis());
        db.insertWithOnConflict("import_chunks",null,row,SQLiteDatabase.CONFLICT_REPLACE);
    }
    static void commit(SQLiteDatabase db,String token,boolean replace,JSONArray deletedNotes) throws Exception {
        commit(db, token, replace, deletedNotes, false);
    }
    static void commit(SQLiteDatabase db,String token,boolean replace,JSONArray deletedNotes,boolean driveRestore) throws Exception {
        db.beginTransaction();
        try {
            ArrayList<String[]> keys=new ArrayList<>();
            try(Cursor rows=db.rawQuery("SELECT scope,id,COUNT(*),MIN(part),MAX(part) FROM import_chunks WHERE token=? GROUP BY scope,id",new String[]{token})) {
                while(rows.moveToNext()) {
                    if(rows.getInt(3)!=0 || rows.getInt(4)!=rows.getInt(2)-1)throw new IOException("导入数据分块不完整，原数据已保留。");
                    keys.add(new String[]{rows.getString(0),rows.getString(1)});
                }
            }
            if(replace && keys.stream().noneMatch(key->key[0].equals("records")&&key[1].equals("settings")))throw new IOException("备份缺少设置数据");
            if (driveRestore) {
                if (!replace || keys.stream().noneMatch(key -> key[0].equals("records") && key[1].equals("drive:whiteNoise"))) {
                    throw new IOException("云端恢复数据不完整。");
                }
                keepDriveRollback(db);
            } else if (keys.stream().anyMatch(key -> key[1].equals("drive:whiteNoise"))) {
                throw new IOException("无效的云端数据导入请求。");
            }
            if(replace){ clear(db,"records");clear(db,"notes"); }
            for(String[] key:keys) {
                delete(db,key[0],key[1]);
                ContentValues row=new ContentValues();row.put("id",key[1]);row.put("value",MARKER);db.insertOrThrow(key[0],null,row);
            }
            db.execSQL("INSERT INTO record_chunks(scope,id,part,payload) SELECT scope,id,part,payload FROM import_chunks WHERE token=?",new Object[]{token});
            if (driveRestore) restoreWhiteNoise(db);
            if(deletedNotes!=null)for(int i=0;i<deletedNotes.length();i++)delete(db,"notes",deletedNotes.getString(i));
            db.delete("import_chunks","token=?",new String[]{token}); db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    private static void keepDriveRollback(SQLiteDatabase db) {
        clearDriveRollback(db);
        db.execSQL("INSERT INTO drive_rollback_rows SELECT 'records',id,value FROM records WHERE id NOT LIKE 'resource:%' OR id='resource:resources'");
        db.execSQL("INSERT INTO drive_rollback_rows SELECT 'notes',id,value FROM notes");
        db.execSQL("INSERT INTO drive_rollback_rows VALUES ('marker','available','1')");
        db.execSQL("INSERT INTO drive_rollback_chunks SELECT scope,id,part,payload FROM record_chunks WHERE id NOT LIKE 'resource:%' OR id='resource:resources' OR scope='notes'");
    }

    private static void restoreWhiteNoise(SQLiteDatabase db) throws Exception {
        JSONArray cloud = (JSONArray) get(db, "records", "drive:whiteNoise");
        Object current = get(db, "records", "resource:resources");
        JSONArray combined = new JSONArray();
        if (current instanceof JSONArray) {
            JSONArray items = (JSONArray) current;
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                if (!"custom".equals(item.optString("origin"))) combined.put(item);
            }
        }
        for (int i = 0; i < cloud.length(); i++) combined.put(cloud.getJSONObject(i));
        put(db, "records", "resource:resources", combined);
        delete(db, "records", "drive:whiteNoise");
    }

    static boolean hasDriveRollback(SQLiteDatabase db) {
        try (Cursor row = db.rawQuery("SELECT 1 FROM drive_rollback_rows WHERE scope='marker' AND id='available'", null)) {
            return row.moveToFirst();
        }
    }

    static void rollbackDrive(SQLiteDatabase db) throws IOException {
        db.beginTransaction();
        try {
            if (!hasDriveRollback(db)) throw new IOException("没有可回退的本地版本。");
            clear(db, "records");
            clear(db, "notes");
            delete(db, "records", "resource:resources");
            db.execSQL("INSERT INTO records SELECT id,value FROM drive_rollback_rows WHERE scope='records'");
            db.execSQL("INSERT INTO notes SELECT id,value FROM drive_rollback_rows WHERE scope='notes'");
            db.execSQL("INSERT INTO record_chunks SELECT scope,id,part,payload FROM drive_rollback_chunks");
            clearDriveRollback(db);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    private static void clearDriveRollback(SQLiteDatabase db) {
        db.delete("drive_rollback_rows", null, null);
        db.delete("drive_rollback_chunks", null, null);
    }
}
