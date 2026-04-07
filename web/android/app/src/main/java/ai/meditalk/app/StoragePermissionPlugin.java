package ai.meditalk.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Lightweight Capacitor plugin that requests storage read permissions
 * so the WebView file picker can read selected files on all Android versions.
 *
 * API 33+: No permission needed — the system file picker grants per-file
 *          URI access automatically. Always returns granted = true.
 * API < 33: Requests READ_EXTERNAL_STORAGE (shows unified
 *           "photos, media, and files" dialog).
 */
@CapacitorPlugin(
    name = "StoragePermission",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "storage"),
    }
)
public class StoragePermissionPlugin extends Plugin {

    @PluginMethod
    public void request(PluginCall call) {
        // Android 13+ (API 33): file picker grants URI access per-file,
        // no storage permission needed.
        if (Build.VERSION.SDK_INT >= 33) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }

        if (isGranted()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestAllPermissions(call, "handleResult");
    }

    @PluginMethod
    public void check(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", isGranted());
        call.resolve(result);
    }

    @PermissionCallback
    private void handleResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", isGranted());
        call.resolve(result);
    }

    private boolean isGranted() {
        // API 33+: always granted (file picker handles access)
        if (Build.VERSION.SDK_INT >= 33) {
            return true;
        }
        return ActivityCompat.checkSelfPermission(
            getContext(), Manifest.permission.READ_EXTERNAL_STORAGE
        ) == PackageManager.PERMISSION_GRANTED;
    }
}
