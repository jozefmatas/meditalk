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
 * API 33+: requests READ_MEDIA_IMAGES + READ_MEDIA_VIDEO (granular).
 * API < 33: requests READ_EXTERNAL_STORAGE (broad).
 */
@CapacitorPlugin(
    name = "StoragePermission",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "storage"),
        @Permission(strings = { "android.permission.READ_MEDIA_IMAGES" }, alias = "images"),
        @Permission(strings = { "android.permission.READ_MEDIA_VIDEO" }, alias = "video"),
    }
)
public class StoragePermissionPlugin extends Plugin {

    @PluginMethod
    public void request(PluginCall call) {
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
        if (Build.VERSION.SDK_INT >= 33) {
            return ActivityCompat.checkSelfPermission(
                getContext(), "android.permission.READ_MEDIA_IMAGES"
            ) == PackageManager.PERMISSION_GRANTED;
        }
        return ActivityCompat.checkSelfPermission(
            getContext(), Manifest.permission.READ_EXTERNAL_STORAGE
        ) == PackageManager.PERMISSION_GRANTED;
    }
}
