#pragma once
// Hardware video encoder via Media Foundation Transform.
//
// Supports H.264 and HEVC (H.265). Tries HEVC first for ~40% better
// compression, falls back to H.264 if unavailable. The --codec flag
// can force a specific codec (needed when insertable streams require
// H.264 to match the WebRTC negotiated codec).
//
// Pipeline (zero CPU copy):
//   BGRA D3D11 texture (from DXGI capture)
//     → ID3D11VideoProcessor (GPU: colorspace convert + scale → NV12)
//     → IMFTransform MFT (GPU: encode → compressed bitstream)
//
// Falls back gracefully: init() returns false if HW encoding is unavailable.

#include <d3d11.h>
#include <dxgi1_2.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>
#include <mferror.h>
#include <strmif.h>
#include <codecapi.h>
#include <stdint.h>
#include <stdio.h>
#include <vector>

#ifdef _MSC_VER
#pragma comment(lib, "mf.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "propsys.lib")
#endif

enum CodecType : uint8_t {
    CODEC_H264 = 0,
    CODEC_HEVC = 1,
};

struct HWEncoder {
    IMFTransform*                     mft          = nullptr;
    IMFDXGIDeviceManager*             dxgiManager  = nullptr;
    UINT                              resetToken   = 0;

    ID3D11VideoDevice*                videoDevice  = nullptr;
    ID3D11VideoContext*                videoCtx     = nullptr;
    ID3D11VideoProcessor*             videoProc    = nullptr;
    ID3D11VideoProcessorEnumerator*   vpEnum       = nullptr;
    ID3D11VideoProcessorOutputView*   vpOutView    = nullptr;
    ID3D11Texture2D*                  nv12Texture  = nullptr;

    ID3D11Device*                     d3dDevice    = nullptr;
    ID3D11DeviceContext*              d3dCtx       = nullptr;

    uint32_t outW = 0, outH = 0;
    uint32_t captureW = 0, captureH = 0;
    bool     mftProvidesSamples = false;

    CodecType codec       = CODEC_H264;
    uint8_t   profileIDC  = 0x64; // H.264 High
    uint8_t   levelIDC    = 0x33; // 5.1
    bool      ready       = false;

    std::vector<uint8_t> encodedBuf;

    // preferred: CODEC_H264 or CODEC_HEVC, or 0xFF for "auto" (try HEVC then H.264)
    bool init(
        ID3D11Device* device, ID3D11DeviceContext* ctx,
        uint32_t capW, uint32_t capH,
        uint32_t oW, uint32_t oH,
        uint32_t fps, uint32_t bitrateBps,
        uint8_t preferredCodec = 0xFF
    ) {
        d3dDevice = device;
        d3dCtx    = ctx;
        captureW  = capW;
        captureH  = capH;
        outW      = oW;
        outH      = oH;

        HRESULT hr = MFStartup(MF_VERSION);
        if (FAILED(hr)) {
            fprintf(stderr, "[encoder] MFStartup failed: 0x%08lx\n", hr);
            return false;
        }

        hr = MFCreateDXGIDeviceManager(&resetToken, &dxgiManager);
        if (FAILED(hr)) { fprintf(stderr, "[encoder] MFCreateDXGIDeviceManager failed\n"); shutdown(); return false; }

        hr = dxgiManager->ResetDevice(d3dDevice, resetToken);
        if (FAILED(hr)) { fprintf(stderr, "[encoder] ResetDevice failed\n"); shutdown(); return false; }

        bool encoderOk = false;
        if (preferredCodec == CODEC_H264) {
            encoderOk = tryCodec(CODEC_H264, fps, bitrateBps);
        } else if (preferredCodec == CODEC_HEVC) {
            encoderOk = tryCodec(CODEC_HEVC, fps, bitrateBps);
            if (!encoderOk) encoderOk = tryCodec(CODEC_H264, fps, bitrateBps);
        } else {
            // Auto: try HEVC first for better compression, fall back to H.264
            encoderOk = tryCodec(CODEC_HEVC, fps, bitrateBps);
            if (!encoderOk) encoderOk = tryCodec(CODEC_H264, fps, bitrateBps);
        }

        if (!encoderOk) {
            fprintf(stderr, "[encoder] no suitable encoder found\n");
            shutdown();
            return false;
        }

        if (!createVideoProcessor()) {
            fprintf(stderr, "[encoder] video processor setup failed\n");
            shutdown();
            return false;
        }

        ready = true;
        const char* codecName = (codec == CODEC_HEVC) ? "HEVC" : "H.264";
        fprintf(stderr, "[encoder] HW %s encoder ready (%ux%u -> %ux%u, %u kbps)\n",
                codecName, captureW, captureH, outW, outH, bitrateBps / 1000);
        return true;
    }

    bool encode(
        ID3D11Texture2D* bgraTexture,
        int64_t timestampHns,
        int64_t durationHns,
        const uint8_t** outData,
        uint32_t* outSize,
        bool* isKeyframe
    ) {
        if (!ready) return false;

        if (!convertToNV12(bgraTexture)) return false;

        IMFMediaBuffer* mediaBuf = nullptr;
        HRESULT hr = MFCreateDXGISurfaceBuffer(
            __uuidof(ID3D11Texture2D), nv12Texture, 0, FALSE, &mediaBuf);
        if (FAILED(hr)) { fprintf(stderr, "[encoder] MFCreateDXGISurfaceBuffer failed\n"); return false; }

        mediaBuf->SetCurrentLength(outW * outH * 3 / 2);

        IMFSample* inputSample = nullptr;
        MFCreateSample(&inputSample);
        inputSample->AddBuffer(mediaBuf);
        inputSample->SetSampleTime(timestampHns);
        inputSample->SetSampleDuration(durationHns);
        mediaBuf->Release();

        hr = mft->ProcessInput(0, inputSample, 0);
        inputSample->Release();
        if (FAILED(hr)) {
            fprintf(stderr, "[encoder] ProcessInput failed: 0x%08lx\n", hr);
            return false;
        }

        return drainOutput(outData, outSize, isKeyframe);
    }

    void shutdown() {
        ready = false;
        if (mft) {
            mft->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            mft->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
            mft->Release(); mft = nullptr;
        }
        if (vpOutView)   { vpOutView->Release();   vpOutView   = nullptr; }
        if (videoProc)   { videoProc->Release();    videoProc   = nullptr; }
        if (vpEnum)      { vpEnum->Release();       vpEnum      = nullptr; }
        if (videoCtx)    { videoCtx->Release();     videoCtx    = nullptr; }
        if (videoDevice) { videoDevice->Release();  videoDevice = nullptr; }
        if (nv12Texture) { nv12Texture->Release();  nv12Texture = nullptr; }
        if (dxgiManager) { dxgiManager->Release();  dxgiManager = nullptr; }
        MFShutdown();
    }

private:
    bool tryCodec(CodecType ct, uint32_t fps, uint32_t bitrateBps) {
        if (mft) { mft->Release(); mft = nullptr; }

        GUID subtype   = (ct == CODEC_HEVC) ? MFVideoFormat_HEVC : MFVideoFormat_H264;
        const char* nm = (ct == CODEC_HEVC) ? "HEVC" : "H.264";

        MFT_REGISTER_TYPE_INFO outInfo = { MFMediaType_Video, subtype };
        IMFActivate** activates = nullptr;
        UINT32 count = 0;

        UINT32 flags = MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER;
        MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, flags, nullptr, &outInfo, &activates, &count);

        if (count == 0) {
            fprintf(stderr, "[encoder] no HW %s encoder, trying SW\n", nm);
            flags = MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER;
            MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, flags, nullptr, &outInfo, &activates, &count);
        }

        if (count == 0) {
            fprintf(stderr, "[encoder] no %s encoder available\n", nm);
            return false;
        }

        fprintf(stderr, "[encoder] found %u %s encoder(s)\n", count, nm);

        for (UINT32 idx = 0; idx < count; idx++) {
            if (mft) { mft->Release(); mft = nullptr; }

            HRESULT hr = activates[idx]->ActivateObject(__uuidof(IMFTransform), (void**)&mft);
            if (FAILED(hr) || !mft) continue;

            IMFAttributes* attrs = nullptr;
            if (SUCCEEDED(mft->GetAttributes(&attrs))) {
                attrs->SetUINT32(MF_SA_D3D11_AWARE, TRUE);

                UINT32 isAsync = FALSE;
                if (SUCCEEDED(attrs->GetUINT32(MF_TRANSFORM_ASYNC, &isAsync)) && isAsync) {
                    fprintf(stderr, "[encoder] MFT[%u] is async, unlocking\n", idx);
                    attrs->SetUINT32(MF_TRANSFORM_ASYNC_UNLOCK, TRUE);
                }

                attrs->Release();
            }

            hr = mft->ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, (ULONG_PTR)dxgiManager);
            if (FAILED(hr)) {
                fprintf(stderr, "[encoder] MFT[%u] SET_D3D_MANAGER failed (0x%08lx)\n", idx, hr);
            }

            IMFMediaType* outType = nullptr;
            MFCreateMediaType(&outType);
            outType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
            outType->SetGUID(MF_MT_SUBTYPE, subtype);
            MFSetAttributeSize(outType, MF_MT_FRAME_SIZE, outW, outH);
            MFSetAttributeRatio(outType, MF_MT_FRAME_RATE, fps, 1);
            outType->SetUINT32(MF_MT_AVG_BITRATE, bitrateBps);
            outType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);

            if (ct == CODEC_HEVC) {
                outType->SetUINT32(MF_MT_MPEG2_PROFILE, 1);
            } else {
                outType->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High);
            }

            hr = mft->SetOutputType(0, outType, 0);
            outType->Release();
            if (FAILED(hr)) {
                fprintf(stderr, "[encoder] MFT[%u] %s SetOutputType failed: 0x%08lx\n", idx, nm, hr);
                mft->Release(); mft = nullptr;
                continue;
            }

            IMFMediaType* inType = nullptr;
            MFCreateMediaType(&inType);
            inType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
            inType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
            MFSetAttributeSize(inType, MF_MT_FRAME_SIZE, outW, outH);
            MFSetAttributeRatio(inType, MF_MT_FRAME_RATE, fps, 1);
            inType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);

            hr = mft->SetInputType(0, inType, 0);
            inType->Release();
            if (FAILED(hr)) {
                fprintf(stderr, "[encoder] MFT[%u] %s SetInputType failed: 0x%08lx\n", idx, nm, hr);
                mft->Release(); mft = nullptr;
                continue;
            }

            fprintf(stderr, "[encoder] MFT[%u] %s accepted\n", idx, nm);
            break;
        }

        for (UINT32 i = 0; i < count; i++) activates[i]->Release();
        CoTaskMemFree(activates);

        if (!mft) {
            fprintf(stderr, "[encoder] %s: all encoders failed\n", nm);
            return false;
        }

        // ── Low-latency / rate-control ──────────────────────────────
        ICodecAPI* codecApi = nullptr;
        if (SUCCEEDED(mft->QueryInterface(__uuidof(ICodecAPI), (void**)&codecApi))) {
            VARIANT var;
            VariantInit(&var);

            var.vt = VT_BOOL;
            var.boolVal = VARIANT_TRUE;
            codecApi->SetValue(&CODECAPI_AVLowLatencyMode, &var);

            var.vt = VT_UI4;
            var.ulVal = eAVEncCommonRateControlMode_CBR;
            codecApi->SetValue(&CODECAPI_AVEncCommonRateControlMode, &var);

            var.vt = VT_UI4;
            var.ulVal = fps * 2;
            codecApi->SetValue(&CODECAPI_AVEncMPVGOPSize, &var);

            codecApi->Release();
        }

        MFT_OUTPUT_STREAM_INFO streamInfo = {};
        mft->GetOutputStreamInfo(0, &streamInfo);
        mftProvidesSamples = !!(streamInfo.dwFlags &
            (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES));

        // Read back negotiated profile/level
        IMFMediaType* negotiated = nullptr;
        if (SUCCEEDED(mft->GetOutputCurrentType(0, &negotiated))) {
            UINT32 profile = 0, level = 0;
            if (ct == CODEC_HEVC) {
                if (SUCCEEDED(negotiated->GetUINT32(MF_MT_MPEG2_PROFILE, &profile))) {
                    profileIDC = (uint8_t)profile; // 1=Main, 2=Main10
                }
                if (SUCCEEDED(negotiated->GetUINT32(MF_MT_MPEG2_LEVEL, &level))) {
                    levelIDC = (uint8_t)level;
                }
            } else {
                if (SUCCEEDED(negotiated->GetUINT32(MF_MT_MPEG2_PROFILE, &profile))) {
                    switch (profile) {
                        case eAVEncH264VProfile_Base: profileIDC = 0x42; break;
                        case eAVEncH264VProfile_Main: profileIDC = 0x4D; break;
                        case eAVEncH264VProfile_High: profileIDC = 0x64; break;
                        default:                      profileIDC = 0x64; break;
                    }
                }
                if (SUCCEEDED(negotiated->GetUINT32(MF_MT_MPEG2_LEVEL, &level))) {
                    levelIDC = (uint8_t)level;
                }
            }
            negotiated->Release();
        }

        codec = ct;
        fprintf(stderr, "[encoder] %s: profile=%u level=%u\n", nm, profileIDC, levelIDC);

        mft->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
        mft->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);

        return true;
    }

    bool createVideoProcessor() {
        HRESULT hr = d3dDevice->QueryInterface(__uuidof(ID3D11VideoDevice), (void**)&videoDevice);
        if (FAILED(hr)) return false;

        hr = d3dCtx->QueryInterface(__uuidof(ID3D11VideoContext), (void**)&videoCtx);
        if (FAILED(hr)) return false;

        D3D11_TEXTURE2D_DESC nv12Desc = {};
        nv12Desc.Width            = outW;
        nv12Desc.Height           = outH;
        nv12Desc.MipLevels        = 1;
        nv12Desc.ArraySize        = 1;
        nv12Desc.Format           = DXGI_FORMAT_NV12;
        nv12Desc.SampleDesc.Count = 1;
        nv12Desc.Usage            = D3D11_USAGE_DEFAULT;
        nv12Desc.BindFlags        = D3D11_BIND_RENDER_TARGET;

        hr = d3dDevice->CreateTexture2D(&nv12Desc, nullptr, &nv12Texture);
        if (FAILED(hr)) {
            fprintf(stderr, "[encoder] CreateTexture2D(NV12) failed: 0x%08lx\n", hr);
            return false;
        }

        D3D11_VIDEO_PROCESSOR_CONTENT_DESC contentDesc = {};
        contentDesc.InputFrameFormat  = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
        contentDesc.InputWidth        = captureW;
        contentDesc.InputHeight       = captureH;
        contentDesc.OutputWidth       = outW;
        contentDesc.OutputHeight      = outH;
        contentDesc.InputFrameRate.Numerator   = 1;
        contentDesc.InputFrameRate.Denominator = 1;
        contentDesc.OutputFrameRate.Numerator  = 1;
        contentDesc.OutputFrameRate.Denominator = 1;
        contentDesc.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;

        hr = videoDevice->CreateVideoProcessorEnumerator(&contentDesc, &vpEnum);
        if (FAILED(hr)) return false;

        hr = videoDevice->CreateVideoProcessor(vpEnum, 0, &videoProc);
        if (FAILED(hr)) return false;

        D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC ovd = {};
        ovd.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
        hr = videoDevice->CreateVideoProcessorOutputView(nv12Texture, vpEnum, &ovd, &vpOutView);
        if (FAILED(hr)) {
            fprintf(stderr, "[encoder] CreateVideoProcessorOutputView failed: 0x%08lx\n", hr);
            return false;
        }

        return true;
    }

    bool convertToNV12(ID3D11Texture2D* bgraTexture) {
        D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC ivd = {};
        ivd.FourCC = 0;
        ivd.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;

        ID3D11VideoProcessorInputView* inputView = nullptr;
        HRESULT hr = videoDevice->CreateVideoProcessorInputView(
            bgraTexture, vpEnum, &ivd, &inputView);
        if (FAILED(hr)) return false;

        D3D11_VIDEO_PROCESSOR_STREAM stream = {};
        stream.Enable        = TRUE;
        stream.pInputSurface = inputView;

        hr = videoCtx->VideoProcessorBlt(videoProc, vpOutView, 0, 1, &stream);
        inputView->Release();

        return SUCCEEDED(hr);
    }

    bool drainOutput(const uint8_t** outData, uint32_t* outSize, bool* isKeyframe) {
        MFT_OUTPUT_DATA_BUFFER mftOut = {};
        mftOut.dwStreamID = 0;

        IMFSample* allocatedSample = nullptr;
        if (!mftProvidesSamples) {
            IMFMediaBuffer* buf = nullptr;
            MFCreateMemoryBuffer(outW * outH * 2, &buf);
            MFCreateSample(&allocatedSample);
            allocatedSample->AddBuffer(buf);
            buf->Release();
            mftOut.pSample = allocatedSample;
        }

        DWORD status = 0;
        HRESULT hr = mft->ProcessOutput(0, 1, &mftOut, &status);

        if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) {
            if (allocatedSample) allocatedSample->Release();
            return false;
        }
        if (FAILED(hr) || !mftOut.pSample) {
            if (allocatedSample) allocatedSample->Release();
            if (mftOut.pSample && !allocatedSample) mftOut.pSample->Release();
            return false;
        }

        IMFMediaBuffer* resultBuf = nullptr;
        mftOut.pSample->ConvertToContiguousBuffer(&resultBuf);
        if (!resultBuf) {
            mftOut.pSample->Release();
            if (allocatedSample) allocatedSample->Release();
            return false;
        }

        BYTE* rawPtr = nullptr;
        DWORD rawLen = 0;
        resultBuf->Lock(&rawPtr, nullptr, &rawLen);

        encodedBuf.resize(rawLen);
        memcpy(encodedBuf.data(), rawPtr, rawLen);
        *outData = encodedBuf.data();
        *outSize = rawLen;

        resultBuf->Unlock();
        resultBuf->Release();

        UINT32 kf = 0;
        mftOut.pSample->GetUINT32(MFSampleExtension_CleanPoint, &kf);
        *isKeyframe = (kf != 0);

        if (mftProvidesSamples) {
            mftOut.pSample->Release();
        } else {
            allocatedSample->Release();
        }

        return rawLen > 0;
    }
};
