import Capacitor
import AVFoundation

/// Local Capacitor plugin that records audio natively using AVAudioEngine
/// and streams Int16 PCM chunks (16 kHz, mono) to JavaScript via events.
///
/// Works when the screen is locked (UIBackgroundModes: audio in Info.plist).
@objc(NativeAudioStreamPlugin)
public class NativeAudioStreamPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "NativeAudioStreamPlugin"
    public let jsName = "NativeAudioStream"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasPermission", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - Constants

    private static let targetSampleRate: Double = 16000
    private static let chunkSize = 4000 // 250 ms at 16 kHz

    // MARK: - State

    private enum Status: String {
        case none = "NONE"
        case recording = "RECORDING"
        case paused = "PAUSED"
    }

    private var status: Status = .none
    private var audioEngine: AVAudioEngine?
    private var sampleBuffer: [Int16] = []
    private var startTime: Date?
    private var accumulatedDurationMs: Double = 0
    private let lock = NSLock()

    // MARK: - Plugin Methods

    @objc func start(_ call: CAPPluginCall) {
        guard status == .none else {
            call.reject("Already recording")
            return
        }

        do {
            try configureAudioSession()
            try startEngine()
            startTime = Date()
            accumulatedDurationMs = 0
            status = .recording
            call.resolve()
        } catch {
            call.reject("Failed to start recording: \(error.localizedDescription)")
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        guard status == .recording, let engine = audioEngine else {
            call.reject("Not recording")
            return
        }

        engine.inputNode.removeTap(onBus: 0)
        engine.pause()

        if let start = startTime {
            accumulatedDurationMs += Date().timeIntervalSince(start) * 1000
        }
        status = .paused
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        guard status == .paused, let engine = audioEngine else {
            call.reject("Not paused")
            return
        }

        do {
            try installTap()
            try engine.start()
            startTime = Date()
            status = .recording
            call.resolve()
        } catch {
            call.reject("Failed to resume: \(error.localizedDescription)")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard status != .none else {
            call.resolve(["durationMs": 0])
            return
        }

        let engine = audioEngine
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        audioEngine = nil

        // Flush remaining buffered samples
        flushBuffer()

        // Calculate total duration
        var totalMs = accumulatedDurationMs
        if status == .recording, let start = startTime {
            totalMs += Date().timeIntervalSince(start) * 1000
        }

        status = .none
        sampleBuffer = []
        startTime = nil

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        call.resolve(["durationMs": Int(totalMs)])
    }

    @objc func getCurrentStatus(_ call: CAPPluginCall) {
        call.resolve(["status": status.rawValue])
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            call.resolve(["permission": granted ? "granted" : "denied"])
        }
    }

    @objc func hasPermission(_ call: CAPPluginCall) {
        let granted = AVAudioSession.sharedInstance().recordPermission == .granted
        call.resolve(["permission": granted])
    }

    // MARK: - Private Helpers

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, options: [.allowBluetooth, .defaultToSpeaker])
        try session.setActive(true)
    }

    private func startEngine() throws {
        let engine = AVAudioEngine()
        audioEngine = engine
        try installTap()
        try engine.start()
    }

    private func installTap() throws {
        guard let engine = audioEngine else { return }

        let inputNode = engine.inputNode
        let nativeFormat = inputNode.outputFormat(forBus: 0)
        let nativeSampleRate = nativeFormat.sampleRate
        let ratio = nativeSampleRate / Self.targetSampleRate

        // Install tap at the hardware's native format — we downsample manually.
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: nativeFormat) { [weak self] buffer, _ in
            self?.processTapBuffer(buffer, ratio: ratio)
        }
    }

    /// Downsample native-rate Float32 PCM to 16 kHz Int16 and emit chunks.
    private func processTapBuffer(_ buffer: AVAudioPCMBuffer, ratio: Double) {
        guard let floatData = buffer.floatChannelData else { return }
        let frameLength = Int(buffer.frameLength)

        lock.lock()

        // Walk through native frames, stepping by `ratio` to produce 16 kHz output.
        // Take channel 0 only (mono). Same nearest-neighbour algorithm as the web AudioWorklet.
        var sourceIndex: Double = 0
        while Int(sourceIndex) < frameLength {
            let idx = Int(sourceIndex)
            let sample = floatData[0][idx]
            let clamped = max(Float(-1.0), min(Float(1.0), sample))
            let int16: Int16 = clamped < 0
                ? Int16(clamped * 32768.0)
                : Int16(clamped * 32767.0)
            sampleBuffer.append(int16)

            if sampleBuffer.count >= Self.chunkSize {
                let chunk = Array(sampleBuffer.prefix(Self.chunkSize))
                sampleBuffer = Array(sampleBuffer.dropFirst(Self.chunkSize))
                lock.unlock()
                sendChunk(chunk)
                lock.lock()
            }

            sourceIndex += ratio
        }

        lock.unlock()
    }

    private func sendChunk(_ samples: [Int16]) {
        let data = samples.withUnsafeBufferPointer { ptr in
            Data(buffer: ptr)
        }
        let base64 = data.base64EncodedString()
        notifyListeners("audioChunk", data: ["chunk": base64])
    }

    private func flushBuffer() {
        lock.lock()
        let remaining = sampleBuffer
        sampleBuffer = []
        lock.unlock()

        if !remaining.isEmpty {
            sendChunk(remaining)
        }
    }
}
