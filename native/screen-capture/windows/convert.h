#pragma once
// BGRA → I420 CPU conversion with nearest-neighbor downscaling (BT.601).
// Used as fallback when hardware encoding is unavailable.

#include <stdint.h>

static void bgraToI420(
    const uint8_t* bgra, uint32_t srcStride,
    uint32_t srcW, uint32_t srcH,
    uint8_t* yPlane, uint8_t* uPlane, uint8_t* vPlane,
    uint32_t dstW, uint32_t dstH
) {
    const float xScale = (float)srcW / (float)dstW;
    const float yScale = (float)srcH / (float)dstH;
    const uint32_t halfW = dstW / 2;

    for (uint32_t dy = 0; dy < dstH; dy++) {
        uint32_t sy = (uint32_t)(dy * yScale);
        if (sy >= srcH) sy = srcH - 1;
        const uint8_t* row = bgra + sy * srcStride;
        uint8_t* yRow = yPlane + dy * dstW;

        for (uint32_t dx = 0; dx < dstW; dx++) {
            uint32_t sx = (uint32_t)(dx * xScale);
            if (sx >= srcW) sx = srcW - 1;
            uint32_t b = row[sx * 4 + 0];
            uint32_t g = row[sx * 4 + 1];
            uint32_t r = row[sx * 4 + 2];
            yRow[dx] = static_cast<uint8_t>(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16);
        }

        if ((dy & 1) == 0) {
            uint32_t syNext = (uint32_t)((dy + 1) * yScale);
            if (syNext >= srcH) syNext = srcH - 1;
            const uint8_t* rowNext = bgra + syNext * srcStride;
            uint8_t* uRow = uPlane + (dy / 2) * halfW;
            uint8_t* vRow = vPlane + (dy / 2) * halfW;

            for (uint32_t cx = 0; cx < halfW; cx++) {
                uint32_t sx0 = (uint32_t)((cx * 2) * xScale);
                uint32_t sx1 = (uint32_t)((cx * 2 + 1) * xScale);
                if (sx0 >= srcW) sx0 = srcW - 1;
                if (sx1 >= srcW) sx1 = srcW - 1;

                uint32_t b = (row[sx0*4+0] + row[sx1*4+0] + rowNext[sx0*4+0] + rowNext[sx1*4+0] + 2) >> 2;
                uint32_t g = (row[sx0*4+1] + row[sx1*4+1] + rowNext[sx0*4+1] + rowNext[sx1*4+1] + 2) >> 2;
                uint32_t r = (row[sx0*4+2] + row[sx1*4+2] + rowNext[sx0*4+2] + rowNext[sx1*4+2] + 2) >> 2;

                int32_t uVal = ((-38*(int32_t)r - 74*(int32_t)g + 112*(int32_t)b + 128) >> 8) + 128;
                int32_t vVal = ((112*(int32_t)r - 94*(int32_t)g - 18*(int32_t)b + 128) >> 8) + 128;
                uRow[cx] = static_cast<uint8_t>(uVal < 0 ? 0 : (uVal > 255 ? 255 : uVal));
                vRow[cx] = static_cast<uint8_t>(vVal < 0 ? 0 : (vVal > 255 ? 255 : vVal));
            }
        }
    }
}
