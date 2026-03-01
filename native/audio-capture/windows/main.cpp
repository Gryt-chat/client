// Captures system audio using WASAPI process loopback and writes raw PCM
// (48 kHz, 16-bit, stereo) to stdout.
//
// Usage:
//   audio-capture.exe exclude <pid>    Capture all audio EXCEPT pid's tree
//   audio-capture.exe include <pid>    Capture ONLY pid's tree audio
//   audio-capture.exe pid-of <hwnd>    Print the owning PID for a window handle
//
// Stop:   write any byte to stdin, or just close stdin.
//
// Requires Windows 10 build 20348+.
//
// Compiles with MSVC (cl.exe) or MinGW (x86_64-w64-mingw32-g++).

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

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <combaseapi.h>
#include <fcntl.h>
#include <io.h>
#include <stdio.h>
#include <stdlib.h>
#include <tlhelp32.h>

#ifdef _MSC_VER
#include <audioclientactivationparams.h>
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "mmdevapi.lib")
#endif

// ── Process loopback API (not in MinGW headers) ────────────────────────

#ifndef AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
typedef enum {
    AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1
} AUDIOCLIENT_ACTIVATION_TYPE;

typedef enum {
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1
} PROCESS_LOOPBACK_MODE;

typedef struct {
    DWORD TargetProcessId;
    PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
} AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;

typedef struct {
    AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
    union {
        AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
    };
} AUDIOCLIENT_ACTIVATION_PARAMS;
#endif

#ifndef VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK
static const WCHAR VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK[] = L"VAD\\Process_Loopback";
#endif

// ── Dynamic loader for ActivateAudioInterfaceAsync (MinGW) ─────────────

typedef HRESULT(WINAPI *PFN_ActivateAudioInterfaceAsync)(
    LPCWSTR, REFIID, PROPVARIANT *,
    IActivateAudioInterfaceCompletionHandler *,
    IActivateAudioInterfaceAsyncOperation **);

static PFN_ActivateAudioInterfaceAsync resolveActivateAudioInterfaceAsync() {
#ifdef _MSC_VER
    return &ActivateAudioInterfaceAsync;
#else
    HMODULE mod = LoadLibraryW(L"mmdevapi.dll");
    if (!mod) return nullptr;
    return reinterpret_cast<PFN_ActivateAudioInterfaceAsync>(
        GetProcAddress(mod, "ActivateAudioInterfaceAsync"));
#endif
}

// ── Diagnostics ────────────────────────────────────────────────────────

typedef LONG(WINAPI *RtlGetVersionPtr)(OSVERSIONINFOEXW *);

static void logWindowsBuild() {
    HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
    if (!ntdll) return;
    auto fn = reinterpret_cast<RtlGetVersionPtr>(GetProcAddress(ntdll, "RtlGetVersion"));
    if (!fn) return;
    OSVERSIONINFOEXW ver = {};
    ver.dwOSVersionInfoSize = sizeof(ver);
    if (fn(&ver) == 0) {
        fprintf(stderr, "[diag] Windows %lu.%lu build %lu\n",
                ver.dwMajorVersion, ver.dwMinorVersion, ver.dwBuildNumber);
    }
}

static void logProcessTree(DWORD rootPid) {
    fprintf(stderr, "[diag] Process tree for PID %lu:\n", rootPid);
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "[diag]   (failed to take process snapshot)\n");
        return;
    }
    PROCESSENTRY32W pe = {};
    pe.dwSize = sizeof(pe);
    if (Process32FirstW(snap, &pe)) {
        do {
            if (pe.th32ProcessID == rootPid || pe.th32ParentProcessID == rootPid) {
                fprintf(stderr, "[diag]   PID %6lu  PPID %6lu  %ls\n",
                        pe.th32ProcessID, pe.th32ParentProcessID, pe.szExeFile);
            }
        } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);
}

// ── IActivateAudioInterfaceCompletionHandler ───────────────────────────

static HANDLE g_activateEvent = nullptr;
static HRESULT g_activateHr = E_FAIL;
static IAudioClient *g_audioClient = nullptr;

struct ActivateHandler : public IActivateAudioInterfaceCompletionHandler {
    LONG refCount = 1;

    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refCount); }
    ULONG STDMETHODCALLTYPE Release() override {
        LONG r = InterlockedDecrement(&refCount);
        if (r == 0) delete this;
        return r;
    }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **ppv) override {
        if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
            *ppv = static_cast<IActivateAudioInterfaceCompletionHandler *>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }

    HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation *op) override {
        HRESULT hrActivate = E_FAIL;
        IUnknown *pUnk = nullptr;
        HRESULT hr = op->GetActivateResult(&hrActivate, &pUnk);
        if (SUCCEEDED(hr) && SUCCEEDED(hrActivate) && pUnk) {
            pUnk->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void **>(&g_audioClient));
        }
        g_activateHr = SUCCEEDED(hr) ? hrActivate : hr;
        SetEvent(g_activateEvent);
        return S_OK;
    }
};

// ── Stdin watcher ──────────────────────────────────────────────────────

static HANDLE g_stopEvent = nullptr;

static DWORD WINAPI stdinWatcher(LPVOID) {
    char buf[16];
    DWORD bytesRead = 0;
    ReadFile(GetStdHandle(STD_INPUT_HANDLE), buf, sizeof(buf), &bytesRead, nullptr);
    SetEvent(g_stopEvent);
    return 0;
}

// ── Main ───────────────────────────────────────────────────────────────

int wmain(int argc, wchar_t *argv[]) {
    if (argc < 3) {
        fprintf(stderr, "Usage:\n");
        fprintf(stderr, "  audio-capture.exe exclude <pid>\n");
        fprintf(stderr, "  audio-capture.exe include <pid>\n");
        fprintf(stderr, "  audio-capture.exe pid-of  <hwnd>\n");
        return 1;
    }

    // ── pid-of: resolve HWND → PID and exit ─────────────────────────
    if (wcscmp(argv[1], L"pid-of") == 0) {
        HWND hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(_wtoi64(argv[2])));
        DWORD ownerPid = 0;
        GetWindowThreadProcessId(hwnd, &ownerPid);
        if (ownerPid == 0) {
            fprintf(stderr, "Could not resolve HWND %llu to PID\n",
                    static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(hwnd)));
            return 1;
        }
        fprintf(stdout, "%lu", ownerPid);
        return 0;
    }

    // ── Determine loopback mode ─────────────────────────────────────
    PROCESS_LOOPBACK_MODE loopbackMode;
    const wchar_t *modeStr = argv[1];
    if (wcscmp(modeStr, L"exclude") == 0) {
        loopbackMode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
    } else if (wcscmp(modeStr, L"include") == 0) {
        loopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
    } else {
        fprintf(stderr, "Unknown mode '%ls' — use 'exclude' or 'include'\n", modeStr);
        return 1;
    }

    DWORD pid = static_cast<DWORD>(_wtoi(argv[2]));
    if (pid == 0) {
        fprintf(stderr, "Invalid PID\n");
        return 1;
    }

    fprintf(stderr, "[diag] audio-capture started, own PID %lu\n", GetCurrentProcessId());
    fprintf(stderr, "[diag] mode=%ls target PID %lu\n", modeStr, pid);
    logWindowsBuild();
    logProcessTree(pid);

    _setmode(_fileno(stdout), _O_BINARY);

    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) {
        fprintf(stderr, "[diag] CoInitializeEx failed: 0x%08lx\n", hr);
        return 1;
    }

    auto pfnActivate = resolveActivateAudioInterfaceAsync();
    if (!pfnActivate) {
        fprintf(stderr, "Failed to resolve ActivateAudioInterfaceAsync from mmdevapi.dll\n");
        return 1;
    }

    g_activateEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    g_stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

    AUDIOCLIENT_ACTIVATION_PARAMS acParams = {};
    acParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    acParams.ProcessLoopbackParams.ProcessLoopbackMode = loopbackMode;
    acParams.ProcessLoopbackParams.TargetProcessId = pid;

    PROPVARIANT pv = {};
    pv.vt = VT_BLOB;
    pv.blob.cbSize = sizeof(acParams);
    pv.blob.pBlobData = reinterpret_cast<BYTE *>(&acParams);

    auto *handler = new ActivateHandler();
    IActivateAudioInterfaceAsyncOperation *asyncOp = nullptr;
    hr = pfnActivate(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        __uuidof(IAudioClient),
        &pv, handler, &asyncOp);
    if (FAILED(hr)) {
        fprintf(stderr, "ActivateAudioInterfaceAsync failed: 0x%08lx\n", hr);
        return 1;
    }
    WaitForSingleObject(g_activateEvent, INFINITE);
    if (asyncOp) asyncOp->Release();
    handler->Release();

    fprintf(stderr, "[diag] activation completed: 0x%08lx, audioClient=%s\n",
            g_activateHr, g_audioClient ? "OK" : "NULL");

    if (FAILED(g_activateHr) || !g_audioClient) {
        fprintf(stderr, "Audio activation failed: 0x%08lx\n", g_activateHr);
        return 1;
    }

    WAVEFORMATEX fmt = {};
    fmt.wFormatTag = WAVE_FORMAT_PCM;
    fmt.nChannels = 2;
    fmt.nSamplesPerSec = 48000;
    fmt.wBitsPerSample = 16;
    fmt.nBlockAlign = fmt.nChannels * fmt.wBitsPerSample / 8;
    fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

    hr = g_audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
            AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
        0, 0, &fmt, nullptr);
    fprintf(stderr, "[diag] AudioClient::Initialize: 0x%08lx\n", hr);
    if (FAILED(hr)) {
        fprintf(stderr, "AudioClient::Initialize failed: 0x%08lx\n", hr);
        return 1;
    }

    HANDLE bufferEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    g_audioClient->SetEventHandle(bufferEvent);

    IAudioCaptureClient *captureClient = nullptr;
    hr = g_audioClient->GetService(__uuidof(IAudioCaptureClient),
                                   reinterpret_cast<void **>(&captureClient));
    fprintf(stderr, "[diag] GetService(IAudioCaptureClient): 0x%08lx\n", hr);
    if (FAILED(hr)) {
        fprintf(stderr, "GetService(IAudioCaptureClient) failed: 0x%08lx\n", hr);
        return 1;
    }

    CreateThread(nullptr, 0, stdinWatcher, nullptr, 0, nullptr);

    g_audioClient->Start();
    fprintf(stderr, "[diag] capture started, entering loop...\n");

    HANDLE waits[] = {bufferEvent, g_stopEvent};
    UINT64 totalFrames = 0;
    UINT64 silentFrames = 0;
    UINT64 packetCount = 0;
    DWORD lastReportTick = GetTickCount();

    for (;;) {
        DWORD waitResult = WaitForMultipleObjects(2, waits, FALSE, 2000);
        if (waitResult == WAIT_OBJECT_0 + 1)
            break;

        UINT32 packetLength = 0;
        while (SUCCEEDED(captureClient->GetNextPacketSize(&packetLength)) && packetLength > 0) {
            BYTE *data = nullptr;
            UINT32 framesAvailable = 0;
            DWORD flags = 0;
            hr = captureClient->GetBuffer(&data, &framesAvailable, &flags, nullptr, nullptr);
            if (FAILED(hr)) break;

            packetCount++;
            totalFrames += framesAvailable;
            DWORD bytes = framesAvailable * fmt.nBlockAlign;

            if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                silentFrames += framesAvailable;
                static const BYTE silence[4096] = {};
                DWORD remaining = bytes;
                while (remaining > 0) {
                    DWORD chunk = remaining < sizeof(silence) ? remaining : sizeof(silence);
                    fwrite(silence, 1, chunk, stdout);
                    remaining -= chunk;
                }
            } else {
                fwrite(data, 1, bytes, stdout);
            }
            fflush(stdout);

            captureClient->ReleaseBuffer(framesAvailable);
        }

        DWORD now = GetTickCount();
        if (now - lastReportTick >= 5000) {
            fprintf(stderr, "[diag] packets=%llu  totalFrames=%llu  silentFrames=%llu (%.1f%%)\n",
                    packetCount, totalFrames, silentFrames,
                    totalFrames > 0 ? 100.0 * silentFrames / totalFrames : 0.0);
            lastReportTick = now;
        }
    }

    fprintf(stderr, "[diag] capture stopped. total packets=%llu frames=%llu silent=%.1f%%\n",
            packetCount, totalFrames,
            totalFrames > 0 ? 100.0 * silentFrames / totalFrames : 0.0);

    g_audioClient->Stop();
    captureClient->Release();
    g_audioClient->Release();
    CloseHandle(bufferEvent);
    CloseHandle(g_activateEvent);
    CloseHandle(g_stopEvent);
    CoUninitialize();
    return 0;
}
