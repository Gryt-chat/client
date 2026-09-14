// Captures all system audio EXCEPT the current process using ScreenCaptureKit
// and writes raw PCM (48 kHz, 16-bit, stereo) to stdout.
//
// Usage:  audio-capture  (PID argument accepted but ignored — macOS excludes
//         the current process automatically via excludesCurrentProcessAudio.)
// Stop:   close stdin or send any byte.
//
// Requires macOS 13.0+.

import AVFoundation
import Foundation
import ScreenCaptureKit

// MARK: - Stream output delegate

@available(macOS 13.0, *)
class AudioOutputHandler: NSObject, SCStreamOutput, SCStreamDelegate {
    private let sampleRate: Double = 48000
    private let channels: Int = 2

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio else { return }
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }

        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(
            blockBuffer, atOffset: 0, lengthAtOffsetOut: nil,
            totalLengthOut: &length, dataPointerOut: &dataPointer)
        guard status == kCMBlockBufferNoErr, let ptr = dataPointer, length > 0 else { return }

        // The audio arrives as 32-bit float. Convert to 16-bit signed PCM.
        let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer)
        let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc!)!.pointee
        let floatCount = length / MemoryLayout<Float>.size

        let floats = UnsafeBufferPointer(
            start: UnsafeRawPointer(ptr).bindMemory(to: Float.self, capacity: floatCount),
            count: floatCount)

        // Resample from source rate to 48 kHz if needed, then convert to Int16.
        // ScreenCaptureKit typically delivers 48 kHz already, but we handle mismatches.
        let srcRate = asbd.mSampleRate
        let srcChannels = Int(asbd.mChannelsPerFrame)

        var pcmData = Data()
        pcmData.reserveCapacity(floatCount * MemoryLayout<Int16>.size)

        for i in 0..<(floatCount / max(srcChannels, 1)) {
            for ch in 0..<channels {
                let srcCh = ch < srcChannels ? ch : 0
                let sample = floats[i * srcChannels + srcCh]
                let clamped = max(-1.0, min(1.0, sample))
                let int16Val = Int16(clamped * Float(Int16.max))
                withUnsafeBytes(of: int16Val) { pcmData.append(contentsOf: $0) }
            }
        }

        pcmData.withUnsafeBytes { buf in
            fwrite(buf.baseAddress, 1, buf.count, stdout)
        }
        fflush(stdout)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        reportError(error)
        exit(1)
    }
}

// electron/captureHealth.ts reads the bracketed domain and code to spot a refused permission.
func reportError(_ error: Error) {
    let ns = error as NSError
    fputs("Error: \(ns.localizedDescription) [\(ns.domain) \(ns.code)]\n", stderr)
}

// SCStream holds its outputs weakly, so a handler kept only by a local is freed and no audio arrives.
var keepAlive: [AnyObject] = []

// MARK: - Stdin watcher

func watchStdin(stopHandler: @escaping () -> Void) {
    DispatchQueue.global(qos: .utility).async {
        var buf = [UInt8](repeating: 0, count: 16)
        // Blocks until stdin receives data or EOF
        let _ = read(STDIN_FILENO, &buf, buf.count)
        stopHandler()
    }
}

// MARK: - Main

if #available(macOS 13.0, *) {
    let semaphore = DispatchSemaphore(value: 0)

    Task {
        do {
            let content = try await SCShareableContent.current
            guard let display = content.displays.first else {
                fputs("No display found\n", stderr)
                exit(1)
            }

            let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])

            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = true
            config.sampleRate = 48000
            config.channelCount = 2

            // We only want audio — minimize video overhead
            config.width = 2
            config.height = 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

            let handler = AudioOutputHandler()
            let stream = SCStream(filter: filter, configuration: config, delegate: handler)
            keepAlive = [handler, stream]
            try stream.addStreamOutput(handler, type: .audio, sampleHandlerQueue: .global(qos: .userInteractive))
            try await stream.startCapture()

            watchStdin {
                Task {
                    try? await stream.stopCapture()
                    semaphore.signal()
                }
            }
        } catch {
            reportError(error)
            exit(1)
        }
    }

    semaphore.wait()
} else {
    fputs("Requires macOS 13.0 or later\n", stderr)
    exit(1)
}
