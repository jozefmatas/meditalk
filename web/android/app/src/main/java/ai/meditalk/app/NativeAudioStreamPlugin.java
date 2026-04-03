package ai.meditalk.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Base64;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Local Capacitor plugin that records audio natively using AudioRecord
 * and streams Int16 PCM chunks (16 kHz, mono) to JavaScript via events.
 *
 * Works when the screen is locked (with foreground service running).
 */
@CapacitorPlugin(
    name = "NativeAudioStream",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class NativeAudioStreamPlugin extends Plugin {

    private static final int SAMPLE_RATE = 16000;
    private static final int CHUNK_SIZE = 4000; // 250 ms at 16 kHz
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;

    private enum Status { NONE, RECORDING, PAUSED }

    private volatile Status status = Status.NONE;
    private AudioRecord audioRecord;
    private Thread recordingThread;
    private volatile boolean isCapturing = false;
    private long startTimeMs = 0;
    private long accumulatedDurationMs = 0;

    @PluginMethod
    public void start(PluginCall call) {
        if (status != Status.NONE) {
            call.reject("Already recording");
            return;
        }

        if (ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            call.reject("Microphone permission not granted");
            return;
        }

        int minBufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT);
        // Use at least 2x min buffer to avoid overruns
        int bufferSize = Math.max(minBufferSize * 2, CHUNK_SIZE * 2);

        audioRecord = new AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            CHANNEL_CONFIG,
            AUDIO_FORMAT,
            bufferSize
        );

        if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
            audioRecord.release();
            audioRecord = null;
            call.reject("Failed to initialize AudioRecord");
            return;
        }

        audioRecord.startRecording();
        isCapturing = true;
        startTimeMs = System.currentTimeMillis();
        accumulatedDurationMs = 0;
        status = Status.RECORDING;

        startCaptureThread();
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (status != Status.RECORDING || audioRecord == null) {
            call.reject("Not recording");
            return;
        }

        isCapturing = false;
        audioRecord.stop();

        accumulatedDurationMs += System.currentTimeMillis() - startTimeMs;
        status = Status.PAUSED;
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        if (status != Status.PAUSED || audioRecord == null) {
            call.reject("Not paused");
            return;
        }

        audioRecord.startRecording();
        isCapturing = true;
        startTimeMs = System.currentTimeMillis();
        status = Status.RECORDING;

        startCaptureThread();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (status == Status.NONE) {
            JSObject result = new JSObject();
            result.put("durationMs", 0);
            call.resolve(result);
            return;
        }

        long totalMs = accumulatedDurationMs;
        if (status == Status.RECORDING) {
            totalMs += System.currentTimeMillis() - startTimeMs;
        }

        isCapturing = false;

        if (audioRecord != null) {
            try {
                audioRecord.stop();
            } catch (IllegalStateException e) {
                // Already stopped
            }
            audioRecord.release();
            audioRecord = null;
        }

        // Wait for capture thread to finish
        if (recordingThread != null) {
            try {
                recordingThread.join(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            recordingThread = null;
        }

        status = Status.NONE;

        JSObject result = new JSObject();
        result.put("durationMs", (int) totalMs);
        call.resolve(result);
    }

    @PluginMethod
    public void getCurrentStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("status", status.name());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            JSObject result = new JSObject();
            result.put("permission", "granted");
            call.resolve(result);
            return;
        }
        // Request via Capacitor's permission system
        requestAllPermissions(call, "handlePermissionResult");
    }

    @PluginMethod
    public void hasPermission(PluginCall call) {
        boolean granted = ActivityCompat.checkSelfPermission(
            getContext(), Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED;

        JSObject result = new JSObject();
        result.put("permission", granted);
        call.resolve(result);
    }

    // Called after permission request completes
    @PermissionCallback
    private void handlePermissionResult(PluginCall call) {
        boolean granted = ActivityCompat.checkSelfPermission(
            getContext(), Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED;

        JSObject result = new JSObject();
        result.put("permission", granted ? "granted" : "denied");
        call.resolve(result);
    }

    // ── Private Helpers ──

    private void startCaptureThread() {
        recordingThread = new Thread(() -> {
            // Read buffer: exactly CHUNK_SIZE samples (Int16 = 2 bytes each)
            short[] buffer = new short[CHUNK_SIZE];

            while (isCapturing) {
                int samplesRead = audioRecord.read(buffer, 0, CHUNK_SIZE);
                if (samplesRead > 0 && isCapturing) {
                    sendChunk(buffer, samplesRead);
                }
            }
        }, "NativeAudioStream-Capture");
        recordingThread.setPriority(Thread.MAX_PRIORITY);
        recordingThread.start();
    }

    private void sendChunk(short[] samples, int count) {
        // Convert Int16 array to little-endian bytes, then base64
        ByteBuffer byteBuffer = ByteBuffer.allocate(count * 2);
        byteBuffer.order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < count; i++) {
            byteBuffer.putShort(samples[i]);
        }
        String base64 = Base64.encodeToString(byteBuffer.array(), 0, count * 2, Base64.NO_WRAP);

        JSObject data = new JSObject();
        data.put("chunk", base64);
        notifyListeners("audioChunk", data);
    }
}
