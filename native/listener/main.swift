// minutes-listener: Ms. Minutes' ears.
//
// A tiny helper the Electron app spawns for one listening session. It captures the
// microphone, runs Apple's ON-DEVICE speech recognizer (audio never leaves the Mac),
// and writes JSON lines to stdout:
//   {"type":"permission","what":"speech"|"mic"}   waiting on a macOS permission prompt
//   {"type":"ready"}                               listening
//   {"type":"level","value":0..1}                  mic loudness (for the waveform)
//   {"type":"partial","text":"..."}                words so far
//   {"type":"final","text":"..."}                  done; process exits right after
//   {"type":"error","code":"...","message":"..."}  failed; process exits
// stdin commands: "stop" (finish and report), "cancel" (exit now). EOF = cancel.
// `minutes-listener --status` prints permission/support status without prompting.

import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

func fail(_ code: String, _ message: String = "") -> Never {
    emit(["type": "error", "code": code, "message": message])
    exit(1)
}

let MAX_SECONDS = 30.0
let FINAL_WAIT = 2.0

final class Listener {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var lastText = ""
    private var stopping = false
    private var finished = false
    private var lastLevelAt: TimeInterval = 0

    func start() {
        guard let rec = SFSpeechRecognizer(locale: Locale(identifier: "en-US")) else { fail("unavailable") }
        recognizer = rec
        guard rec.isAvailable else { fail("unavailable") }
        // Never fall back to Apple's servers: if on-device isn't possible, say so.
        guard rec.supportsOnDeviceRecognition else { fail("no-on-device") }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = true
        req.taskHint = .dictation
        if #available(macOS 13, *) { req.addsPunctuation = true }
        req.contextualStrings = ["Ms. Minutes", "Miss Minutes", "task", "assignment", "due", "extend", "postpone",
                                 "mark done", "records", "settings", "tomorrow", "tonight", "a.m.", "p.m."]
        request = req

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { fail("no-mic", "No microphone input is available.") }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
            self?.reportLevel(buffer)
        }

        task = rec.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self, !self.finished else { return }
                if let result = result {
                    let text = result.bestTranscription.formattedString
                    if text != self.lastText {
                        self.lastText = text
                        emit(["type": "partial", "text": text])
                    }
                    if result.isFinal { self.finish() }
                } else if let error = error as NSError? {
                    self.handleError(error)
                }
            }
        }

        engine.prepare()
        do { try engine.start() } catch { fail("mic-start", error.localizedDescription) }
        emit(["type": "ready"])
        DispatchQueue.main.asyncAfter(deadline: .now() + MAX_SECONDS) { [weak self] in self?.stop() }
    }

    private func handleError(_ error: NSError) {
        let desc = error.localizedDescription.lowercased()
        // 1110 = "no speech detected": just report whatever we heard (maybe nothing).
        if error.code == 1110 || !lastText.isEmpty { finish(); return }
        // 1101 / kLSRErrorDomain 201 = "Siri and Dictation are disabled" in System Settings.
        if error.code == 1101 || (error.domain == "kLSRErrorDomain" && error.code == 201) || desc.contains("dictation") {
            stopAudio()
            fail("dictation-off", error.localizedDescription)
        }
        stopAudio()
        fail("recognizer", "\(error.domain) \(error.code): \(error.localizedDescription)")
    }

    private func reportLevel(_ buffer: AVAudioPCMBuffer) {
        guard let ch = buffer.floatChannelData?[0] else { return }
        let n = Int(buffer.frameLength)
        if n == 0 { return }
        var sum: Float = 0
        for i in 0..<n { sum += ch[i] * ch[i] }
        let rms = sqrt(sum / Float(n))
        let db = 20 * log10(max(rms, 1e-7))
        let level = max(0, min(1, (db + 55) / 45)) // -55 dB → 0, -10 dB → 1
        DispatchQueue.main.async {
            let now = Date().timeIntervalSince1970
            if now - self.lastLevelAt < 0.05 { return }
            self.lastLevelAt = now
            emit(["type": "level", "value": (Double(level) * 1000).rounded() / 1000])
        }
    }

    private func stopAudio() {
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
    }

    func stop() {
        guard !stopping, !finished else { return }
        stopping = true
        stopAudio()
        request?.endAudio()
        // Give the recognizer a moment to produce its final result.
        DispatchQueue.main.asyncAfter(deadline: .now() + FINAL_WAIT) { [weak self] in self?.finish() }
    }

    func finish() {
        guard !finished else { return }
        finished = true
        stopAudio()
        task?.cancel()
        emit(["type": "final", "text": lastText])
        exit(0)
    }
}

// ---------------------------------------------------------------- permissions
func requireMic(_ next: @escaping () -> Void) {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: next()
    case .notDetermined:
        emit(["type": "permission", "what": "mic"])
        AVCaptureDevice.requestAccess(for: .audio) { ok in
            DispatchQueue.main.async { if ok { next() } else { fail("mic-denied") } }
        }
    default: fail("mic-denied")
    }
}

func requireSpeech(_ next: @escaping () -> Void) {
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized: next()
    case .notDetermined:
        emit(["type": "permission", "what": "speech"])
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async { if status == .authorized { next() } else { fail("speech-denied") } }
        }
    default: fail("speech-denied")
    }
}

func statusName(_ raw: Int) -> String {
    switch raw { case 0: return "not-determined"; case 1: return "restricted"; case 2: return "denied"; default: return "authorized" }
}

// ---------------------------------------------------------------- main
if CommandLine.arguments.contains("--status") {
    let rec = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    emit([
        "type": "status",
        "speech": statusName(SFSpeechRecognizer.authorizationStatus().rawValue),
        "mic": statusName(AVCaptureDevice.authorizationStatus(for: .audio).rawValue),
        "onDevice": rec?.supportsOnDeviceRecognition ?? false,
    ])
    exit(0)
}

let listener = Listener()

// stdin control channel
Thread.detachNewThread {
    while let line = readLine() {
        let cmd = line.trimmingCharacters(in: .whitespaces)
        DispatchQueue.main.async {
            if cmd == "stop" { listener.stop() }
            if cmd == "cancel" { exit(0) }
        }
    }
    DispatchQueue.main.async { exit(0) } // parent went away
}

requireSpeech { requireMic { listener.start() } }
dispatchMain()
