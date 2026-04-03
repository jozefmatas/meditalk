#import <Capacitor/Capacitor.h>

CAP_PLUGIN(NativeAudioStreamPlugin, "NativeAudioStream",
    CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(pause, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(resume, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getCurrentStatus, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(requestPermission, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(hasPermission, CAPPluginReturnPromise);
)
