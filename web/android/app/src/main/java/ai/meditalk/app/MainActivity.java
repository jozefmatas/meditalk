package ai.meditalk.app;

import android.content.pm.ApplicationInfo;
import android.net.http.SslError;
import android.os.Bundle;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeAudioStreamPlugin.class);
        super.onCreate(savedInstanceState);

        // Accept self-signed dev certs (mkcert) in debug builds
        boolean isDebug = (getApplicationInfo().flags
                & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (isDebug) {
            getBridge().getWebView().setWebViewClient(
                new BridgeWebViewClient(getBridge()) {
                    @Override
                    public void onReceivedSslError(WebView view,
                            SslErrorHandler handler, SslError error) {
                        handler.proceed();
                    }
                }
            );
        }
    }
}
