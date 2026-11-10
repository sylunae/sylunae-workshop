package studio.sylunae.workshop;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.util.function.Consumer;

public class MainActivity extends BridgeActivity {
    private Consumer<ActivityResult> driveAuthorizationCallback;
    private final ActivityResultLauncher<IntentSenderRequest> driveAuthorization =
        registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            Consumer<ActivityResult> callback = driveAuthorizationCallback;
            driveAuthorizationCallback = null;
            if (callback != null) callback.accept(result);
        });

    void authorizeDrive(IntentSenderRequest request, Consumer<ActivityResult> callback) {
        if (driveAuthorizationCallback != null) throw new IllegalStateException("Google Drive 正在等待授权。");
        driveAuthorizationCallback = callback;
        try { driveAuthorization.launch(request); }
        catch (RuntimeException error) { driveAuthorizationCallback = null; throw error; }
    }

    @Override public void onCreate(Bundle state) {
        registerPlugin(WorkshopFilesPlugin.class);
        registerPlugin(WorkshopPlayerPlugin.class);
        registerPlugin(WorkshopUpdatesPlugin.class);
        registerPlugin(WorkshopDrivePlugin.class);
        super.onCreate(state);
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content), (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            androidx.core.graphics.Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
