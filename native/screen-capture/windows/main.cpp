// Mini-Sunshine: high-FPS screen capture with HW encoding (HEVC / H.264).
//
// Two encoding modes (auto-negotiated):
//   Encoded (preferred) — DXGI capture → GPU NV12 convert → HW encode
//                         → compressed bitstream over WebSocket.
//   Raw (fallback)      — DXGI capture → CPU I420 convert → raw pixels over
//                         WebSocket or stdout.
//
// Two transport modes:
//   --ws     WebSocket server on 127.0.0.1 (port printed to stderr).
//   (none)   Raw I420 frames on stdout (legacy Electron IPC relay).
//
// Frame protocol (WebSocket binary messages):
//   type=0  Raw I420:  [u8 type][u32 w][u32 h][i64 ts_us][I420 data]
//   type=1  Encoded:   [u8 type][u8 keyframe][u32 w][u32 h][i64 ts_us][Annex B NAL]
//   type=2  Config:    [u8 type][u32 w][u32 h][u8 codec][u8 profile][u8 level]
//
// Usage:
//   screen-capture.exe <monitor> <fps> [W H] [--ws] [--bitrate <bps>]
//                      [--codec h264|hevc|auto] [--no-encode]
//
// Stop: write any byte to stdin, or close stdin.
// Requires Windows 10 1803+ (DXGI 1.5).

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NTDDI_VERSION
#define NTDDI_VERSION 0x0A000000
#endif
#ifndef WINVER
#define WINVER 0x0A00
#endif
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <fcntl.h>
#include <io.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>

#ifdef _MSC_VER
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#endif

#include "convert.h"
#include "ws.h"
#include "encoder.h"

// ── Stop signal ────────────────────────────────────────────────────────

static HANDLE g_stopEvent = nullptr;

static DWORD WINAPI stdinWatcher(LPVOID) {
    char buf[16];
    DWORD bytesRead = 0;
    ReadFile(GetStdHandle(STD_INPUT_HANDLE), buf, sizeof(buf), &bytesRead, nullptr);
    SetEvent(g_stopEvent);
    return 0;
}

// ── Main ───────────────────────────────────────────────────────────────

int wmain(int argc, wchar_t* argv[]) {
    if (argc < 3) {
        fprintf(stderr, "Usage: screen-capture.exe <monitor> <fps> [W H] [--ws] [--bitrate <bps>] [--codec h264|hevc|auto] [--no-encode]\n");
        return 1;
    }

    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    int monitorIndex = _wtoi(argv[1]);
    int targetFps    = _wtoi(argv[2]);
    uint32_t maxWidth = 0, maxHeight = 0;
    bool wsMode         = false;
    bool noEncode       = false;
    uint32_t bitrate    = 0; // 0 = auto
    uint8_t codecPref   = 0xFF; // auto

    for (int i = 3; i < argc; i++) {
        if (wcscmp(argv[i], L"--ws") == 0) {
            wsMode = true;
        } else if (wcscmp(argv[i], L"--no-encode") == 0) {
            noEncode = true;
        } else if (wcscmp(argv[i], L"--bitrate") == 0 && i + 1 < argc) {
            bitrate = (uint32_t)_wtoi(argv[++i]);
        } else if (wcscmp(argv[i], L"--codec") == 0 && i + 1 < argc) {
            i++;
            if (wcscmp(argv[i], L"h264") == 0)      codecPref = CODEC_H264;
            else if (wcscmp(argv[i], L"hevc") == 0)  codecPref = CODEC_HEVC;
            // else remains 0xFF = auto
        } else if (maxWidth == 0 && i + 1 < argc) {
            // Positional W H pair (skip if next arg is a flag)
            if (argv[i + 1][0] != L'-') {
                maxWidth  = (uint32_t)_wtoi(argv[i]);
                maxHeight = (uint32_t)_wtoi(argv[i + 1]);
                i++;
            } else {
                maxWidth = (uint32_t)_wtoi(argv[i]);
            }
        } else if (maxWidth == 0) {
            maxWidth = (uint32_t)_wtoi(argv[i]);
        }
    }

    if (targetFps < 1) targetFps = 30;
    if (targetFps > 500) targetFps = 500;

    const char* codecName = codecPref == CODEC_H264 ? "h264" : codecPref == CODEC_HEVC ? "hevc" : "auto";
    fprintf(stderr, "[screen-capture] monitor=%d fps=%d maxRes=%ux%u ws=%s encode=%s codec=%s bitrate=%u\n",
            monitorIndex, targetFps, maxWidth, maxHeight,
            wsMode ? "true" : "false", noEncode ? "disabled" : "auto", codecName, bitrate);

    if (!wsMode) {
        _setmode(_fileno(stdout), _O_BINARY);
    }
    g_stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

    // ── D3D11 device ─────────────────────────────────────────────────

    ID3D11Device* device = nullptr;
    ID3D11DeviceContext* context = nullptr;
    D3D_FEATURE_LEVEL featureLevel;

    HRESULT hr = D3D11CreateDevice(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
        0, nullptr, 0, D3D11_SDK_VERSION,
        &device, &featureLevel, &context);
    if (FAILED(hr)) {
        fprintf(stderr, "[screen-capture] D3D11CreateDevice failed: 0x%08lx\n", hr);
        return 1;
    }

    // ── DXGI output ──────────────────────────────────────────────────

    IDXGIDevice* dxgiDevice = nullptr;
    device->QueryInterface(__uuidof(IDXGIDevice), (void**)&dxgiDevice);

    IDXGIAdapter* adapter = nullptr;
    dxgiDevice->GetAdapter(&adapter);

    IDXGIOutput* output = nullptr;
    hr = adapter->EnumOutputs(monitorIndex, &output);
    if (FAILED(hr)) {
        fprintf(stderr, "[screen-capture] monitor index %d not found\n", monitorIndex);
        adapter->Release(); dxgiDevice->Release(); context->Release(); device->Release();
        return 1;
    }

    DXGI_OUTPUT_DESC outputDesc;
    output->GetDesc(&outputDesc);
    uint32_t screenW = outputDesc.DesktopCoordinates.right  - outputDesc.DesktopCoordinates.left;
    uint32_t screenH = outputDesc.DesktopCoordinates.bottom - outputDesc.DesktopCoordinates.top;
    fprintf(stderr, "[screen-capture] output: %ls %ux%u\n", outputDesc.DeviceName, screenW, screenH);

    IDXGIOutput1* output1 = nullptr;
    output->QueryInterface(__uuidof(IDXGIOutput1), (void**)&output1);
    output->Release();

    // ── Desktop Duplication ──────────────────────────────────────────

    IDXGIOutputDuplication* duplication = nullptr;
    hr = output1->DuplicateOutput(device, &duplication);
    if (FAILED(hr)) {
        fprintf(stderr, "[screen-capture] DuplicateOutput failed: 0x%08lx\n", hr);
        output1->Release(); adapter->Release(); dxgiDevice->Release();
        context->Release(); device->Release();
        return 1;
    }

    DXGI_OUTDUPL_DESC duplDesc;
    duplication->GetDesc(&duplDesc);
    uint32_t captureW = duplDesc.ModeDesc.Width;
    uint32_t captureH = duplDesc.ModeDesc.Height;

    // Output dimensions (aspect-correct downscale)
    uint32_t outW = captureW;
    uint32_t outH = captureH;
    if (maxWidth > 0 && maxHeight > 0 && (captureW > maxWidth || captureH > maxHeight)) {
        float scaleW = (float)maxWidth / captureW;
        float scaleH = (float)maxHeight / captureH;
        float scale  = scaleW < scaleH ? scaleW : scaleH;
        outW = ((uint32_t)(captureW * scale)) & ~1u;
        outH = ((uint32_t)(captureH * scale)) & ~1u;
    }
    outW &= ~1u;
    outH &= ~1u;

    fprintf(stderr, "[screen-capture] capture=%ux%u output=%ux%u\n", captureW, captureH, outW, outH);

    // ── Hardware encoder (optional) ──────────────────────────────────

    HWEncoder encoder;
    bool useHWEncode = false;

    if (wsMode && !noEncode) {
        if (bitrate == 0) {
            // Auto bitrate: ~3 bits/pixel scaled by fps/30
            double bpp = 3.0;
            double fpsScale = pow((double)targetFps / 30.0, 0.7);
            bitrate = (uint32_t)(outW * outH * bpp * fpsScale);
            if (bitrate > 50000000) bitrate = 50000000;
            if (bitrate < 500000)   bitrate = 500000;
        }

        useHWEncode = encoder.init(device, context, captureW, captureH, outW, outH, targetFps, bitrate, codecPref);
        if (!useHWEncode) {
            fprintf(stderr, "[screen-capture] HW encoder unavailable, using raw I420 fallback\n");
        }
    }

    // ── Staging texture + I420 buffer (for raw fallback) ─────────────

    ID3D11Texture2D* stagingTexture = nullptr;
    uint8_t* msgBuf = nullptr;
    uint32_t i420Size = 0;
    uint32_t rawMsgSize = 0;

    if (!useHWEncode) {
        D3D11_TEXTURE2D_DESC stagingDesc = {};
        stagingDesc.Width            = captureW;
        stagingDesc.Height           = captureH;
        stagingDesc.MipLevels        = 1;
        stagingDesc.ArraySize        = 1;
        stagingDesc.Format           = DXGI_FORMAT_B8G8R8A8_UNORM;
        stagingDesc.SampleDesc.Count = 1;
        stagingDesc.Usage            = D3D11_USAGE_STAGING;
        stagingDesc.CPUAccessFlags   = D3D11_CPU_ACCESS_READ;

        hr = device->CreateTexture2D(&stagingDesc, nullptr, &stagingTexture);
        if (FAILED(hr)) {
            fprintf(stderr, "[screen-capture] CreateTexture2D (staging) failed: 0x%08lx\n", hr);
            return 1;
        }

        i420Size = outW * outH * 3 / 2;
        // Raw message: 1 (type) + 4 (w) + 4 (h) + 8 (ts) + I420
        rawMsgSize = 17 + i420Size;
        msgBuf = (uint8_t*)malloc(rawMsgSize);
        if (!msgBuf) {
            fprintf(stderr, "[screen-capture] malloc(%u) failed\n", rawMsgSize);
            return 1;
        }
    }

    // ── WebSocket server (if --ws) ───────────────────────────────────

    SOCKET listenSock = INVALID_SOCKET;
    SOCKET clientSock = INVALID_SOCKET;

    if (wsMode) {
        uint16_t port = 0;
        listenSock = wsListen(&port);
        if (listenSock == INVALID_SOCKET) {
            fprintf(stderr, "[screen-capture] failed to create WebSocket listener\n");
            free(msgBuf); return 1;
        }
        fprintf(stderr, "[ws] port=%u\n", port);
        fflush(stderr);

        fd_set readSet;
        FD_ZERO(&readSet);
        FD_SET(listenSock, &readSet);
        struct timeval tv = { 30, 0 };
        int sel = select(0, &readSet, nullptr, nullptr, &tv);
        if (sel <= 0) {
            fprintf(stderr, "[screen-capture] no WebSocket client within timeout\n");
            closesocket(listenSock); WSACleanup(); free(msgBuf); return 1;
        }

        clientSock = accept(listenSock, nullptr, nullptr);
        closesocket(listenSock);
        listenSock = INVALID_SOCKET;

        if (clientSock == INVALID_SOCKET) {
            fprintf(stderr, "[screen-capture] accept failed\n");
            WSACleanup(); free(msgBuf); return 1;
        }

        int bufSize = 32 * 1024 * 1024;
        setsockopt(clientSock, SOL_SOCKET, SO_SNDBUF, (const char*)&bufSize, sizeof(bufSize));
        int noDelay = 1;
        setsockopt(clientSock, IPPROTO_TCP, TCP_NODELAY, (const char*)&noDelay, sizeof(noDelay));

        if (!wsHandshake(clientSock)) {
            fprintf(stderr, "[screen-capture] WebSocket handshake failed\n");
            closesocket(clientSock); WSACleanup(); free(msgBuf); return 1;
        }
        fprintf(stderr, "[screen-capture] WebSocket client connected\n");

        // For encoded mode, send a config message so the renderer sets up VideoDecoder
        if (useHWEncode) {
            // [type=2][u32 w][u32 h][u8 codec][u8 profile][u8 level]
            uint8_t configMsg[12];
            configMsg[0] = 2;
            memcpy(configMsg + 1, &outW, 4);
            memcpy(configMsg + 5, &outH, 4);
            configMsg[9]  = (uint8_t)encoder.codec;
            configMsg[10] = encoder.profileIDC;
            configMsg[11] = encoder.levelIDC;
            wsSendBinary(clientSock, configMsg, 12);
        }
    }

    // ── Capture loop ─────────────────────────────────────────────────

    CreateThread(nullptr, 0, stdinWatcher, nullptr, 0, nullptr);

    LARGE_INTEGER freq, startTime, frameTime;
    QueryPerformanceFrequency(&freq);
    QueryPerformanceCounter(&startTime);

    double frameInterval = 1000.0 / targetFps;
    DWORD frameIntervalMs = (DWORD)frameInterval;
    if (frameIntervalMs < 1) frameIntervalMs = 1;

    uint64_t framesWritten = 0;
    uint64_t framesFailed  = 0;
    DWORD lastStatsTick = GetTickCount();

    fprintf(stderr, "[screen-capture] capture loop starting (encode=%s interval=%lums)\n",
            useHWEncode ? "H264" : "raw", frameIntervalMs);

    while (WaitForSingleObject(g_stopEvent, 0) != WAIT_OBJECT_0) {
        DXGI_OUTDUPL_FRAME_INFO frameInfo;
        IDXGIResource* desktopResource = nullptr;

        hr = duplication->AcquireNextFrame(frameIntervalMs, &frameInfo, &desktopResource);
        if (hr == DXGI_ERROR_WAIT_TIMEOUT) continue;
        if (hr == DXGI_ERROR_ACCESS_LOST) {
            fprintf(stderr, "[screen-capture] access lost, stopping\n");
            break;
        }
        if (FAILED(hr)) { framesFailed++; Sleep(1); continue; }

        ID3D11Texture2D* desktopTexture = nullptr;
        desktopResource->QueryInterface(__uuidof(ID3D11Texture2D), (void**)&desktopTexture);
        desktopResource->Release();

        QueryPerformanceCounter(&frameTime);
        int64_t timestampUs = (int64_t)((frameTime.QuadPart - startTime.QuadPart) * 1000000LL / freq.QuadPart);

        if (useHWEncode && wsMode) {
            // ── Encoded path: GPU convert + HW encode ────────────────
            int64_t tsHns      = timestampUs * 10;  // microseconds → 100ns
            int64_t durHns     = 10000000LL / targetFps;
            const uint8_t* encoded = nullptr;
            uint32_t encodedSize   = 0;
            bool keyframe          = false;

            bool ok = encoder.encode(desktopTexture, tsHns, durHns,
                                     &encoded, &encodedSize, &keyframe);
            desktopTexture->Release();
            duplication->ReleaseFrame();

            if (ok && encodedSize > 0) {
                // [type=1][keyframe][w][h][ts_us][NAL data]
                const uint32_t hdrSize = 18;
                uint32_t totalSize = hdrSize + encodedSize;
                std::vector<uint8_t> wsPayload(totalSize);
                wsPayload[0] = 1; // type = H264
                wsPayload[1] = keyframe ? 1 : 0;
                memcpy(wsPayload.data() + 2,  &outW, 4);
                memcpy(wsPayload.data() + 6,  &outH, 4);
                memcpy(wsPayload.data() + 10, &timestampUs, 8);
                memcpy(wsPayload.data() + hdrSize, encoded, encodedSize);

                if (!wsSendBinary(clientSock, wsPayload.data(), totalSize)) {
                    fprintf(stderr, "[screen-capture] WS send failed\n");
                    break;
                }
                framesWritten++;
            } else {
                framesFailed++;
            }
        } else {
            // ── Raw path: CPU readback + I420 conversion ─────────────
            context->CopyResource(stagingTexture, desktopTexture);
            desktopTexture->Release();
            duplication->ReleaseFrame();

            D3D11_MAPPED_SUBRESOURCE mapped;
            hr = context->Map(stagingTexture, 0, D3D11_MAP_READ, 0, &mapped);
            if (FAILED(hr)) { framesFailed++; continue; }

            uint8_t* payload = msgBuf;
            uint32_t sendSize;

            if (wsMode) {
                // New protocol: [type=0][w][h][ts][I420]
                payload[0] = 0; // type = raw
                memcpy(payload + 1, &outW, 4);
                memcpy(payload + 5, &outH, 4);
                memcpy(payload + 9, &timestampUs, 8);

                uint8_t* i420 = payload + 17;
                uint8_t* yPlane = i420;
                uint8_t* uPlane = i420 + outW * outH;
                uint8_t* vPlane = uPlane + (outW / 2) * (outH / 2);

                bgraToI420((const uint8_t*)mapped.pData, mapped.RowPitch,
                           captureW, captureH, yPlane, uPlane, vPlane, outW, outH);

                sendSize = rawMsgSize;
            } else {
                // Legacy stdout: [w][h][ts][I420] (no type byte)
                memcpy(payload, &outW, 4);
                memcpy(payload + 4, &outH, 4);
                memcpy(payload + 8, &timestampUs, 8);

                uint8_t* i420 = payload + 16;
                uint8_t* yPlane = i420;
                uint8_t* uPlane = i420 + outW * outH;
                uint8_t* vPlane = uPlane + (outW / 2) * (outH / 2);

                bgraToI420((const uint8_t*)mapped.pData, mapped.RowPitch,
                           captureW, captureH, yPlane, uPlane, vPlane, outW, outH);

                sendSize = 16 + i420Size;
            }

            context->Unmap(stagingTexture, 0);

            if (wsMode) {
                if (!wsSendBinary(clientSock, payload, sendSize)) {
                    fprintf(stderr, "[screen-capture] WS send failed\n");
                    break;
                }
            } else {
                if (fwrite(payload, 1, sendSize, stdout) != sendSize) break;
                fflush(stdout);
            }

            framesWritten++;
        }

        // Frame pacing
        LARGE_INTEGER now;
        QueryPerformanceCounter(&now);
        double elapsedMs = (double)(now.QuadPart - frameTime.QuadPart) * 1000.0 / freq.QuadPart;
        double sleepMs   = frameInterval - elapsedMs;
        if (sleepMs > 1.0) Sleep((DWORD)sleepMs);

        DWORD nowTick = GetTickCount();
        if (nowTick - lastStatsTick >= 5000) {
            double elapsed = (double)(nowTick - lastStatsTick) / 1000.0;
            fprintf(stderr, "[screen-capture] %.1f fps (%s), %llu failed\n",
                    framesWritten / elapsed, useHWEncode ? "encoded" : "raw", framesFailed);
            framesWritten = 0;
            framesFailed  = 0;
            lastStatsTick = nowTick;
        }
    }

    // ── Cleanup ──────────────────────────────────────────────────────

    fprintf(stderr, "[screen-capture] stopping\n");

    if (useHWEncode) encoder.shutdown();
    free(msgBuf);
    if (stagingTexture) stagingTexture->Release();
    if (clientSock != INVALID_SOCKET) closesocket(clientSock);
    if (listenSock != INVALID_SOCKET) closesocket(listenSock);
    if (wsMode) WSACleanup();
    duplication->Release();
    output1->Release();
    adapter->Release();
    dxgiDevice->Release();
    context->Release();
    device->Release();
    CloseHandle(g_stopEvent);
    CoUninitialize();
    return 0;
}
