// CAMAI ACAP — Frame Preprocessor
// Converts VDO native frames (NV12 / YUV420 / RGB) to the float32 BGR tensor
// required by YOLOX inference on Larod.
//
// YOLOX preprocessing contract (matches server/app/ai/backend.py):
//   1. Letterbox resize source to (INPUT_W × INPUT_H) padding with value 114.
//   2. Output is float32 BGR, CHW layout, NOT normalized (raw [0,255]).
//   3. No mean subtraction, no std division — YOLOX bakes that into its
//      BatchNorm layers.
//
// On AXIS hardware the VDO API delivers frames in NV12 (Y-plane + interleaved
// UV half-resolution). This converts to BGR then letterboxes. When building
// without ACAP_NATIVE_BUILD the functions accept a pre-filled BGR uint8 buffer
// for host-mode unit testing (see tests/test_pipeline.cpp).

#ifndef CAMAI_PREPROCESSOR_HPP
#define CAMAI_PREPROCESSOR_HPP

#include "video_pipeline.hpp"
#include <cstdint>
#include <cstring>
#include <cmath>
#include <vector>
#include <iostream>

namespace CamAI {

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

// Default YOLOX input resolution. Must match the exported model.
// Can be overridden via compile flag: -DCAMAI_INPUT_W=640 -DCAMAI_INPUT_H=640
#ifndef CAMAI_INPUT_W
#  define CAMAI_INPUT_W 416
#endif
#ifndef CAMAI_INPUT_H
#  define CAMAI_INPUT_H 416
#endif

static constexpr int INFER_W    = CAMAI_INPUT_W;
static constexpr int INFER_H    = CAMAI_INPUT_H;
static constexpr float PAD_VAL  = 114.0f;   // YOLOX canonical letterbox pad

// ──────────────────────────────────────────────────────────────────────────────
// LetterboxParams — records the padding applied so postprocessing can undo it
// ──────────────────────────────────────────────────────────────────────────────

struct LetterboxParams {
    float scale;     // Uniform scale applied to source frame
    int   pad_top;   // Rows of padding added on top
    int   pad_left;  // Cols of padding added on left
    int   src_w;     // Source frame width (before scale)
    int   src_h;     // Source frame height (before scale)
};

// ──────────────────────────────────────────────────────────────────────────────
// NV12 → BGR conversion (simple bilinear-free nearest-neighbour)
// NV12 layout: Y plane [W×H bytes], then interleaved UV [W×H/2 bytes].
// ──────────────────────────────────────────────────────────────────────────────

inline void nv12_to_bgr_row(
    const uint8_t* __restrict__ y_plane,
    const uint8_t* __restrict__ uv_plane,
    uint8_t*       __restrict__ bgr_out,
    int row, int width)
{
    const uint8_t* y_row  = y_plane  + row * width;
    const uint8_t* uv_row = uv_plane + (row / 2) * width; // interleaved UV

    for (int x = 0; x < width; ++x) {
        int Y  = static_cast<int>(y_row[x]);
        int U  = static_cast<int>(uv_row[(x & ~1)]);        // even col
        int V  = static_cast<int>(uv_row[(x & ~1) + 1]);    // odd col

        // BT.601 limited range YCbCr → RGB
        int C  = Y - 16;
        int D  = U - 128;
        int E  = V - 128;

        int R  = (298 * C           + 409 * E + 128) >> 8;
        int G  = (298 * C - 100 * D - 208 * E + 128) >> 8;
        int B  = (298 * C + 516 * D           + 128) >> 8;

        bgr_out[x * 3 + 0] = static_cast<uint8_t>(B < 0 ? 0 : B > 255 ? 255 : B);
        bgr_out[x * 3 + 1] = static_cast<uint8_t>(G < 0 ? 0 : G > 255 ? 255 : G);
        bgr_out[x * 3 + 2] = static_cast<uint8_t>(R < 0 ? 0 : R > 255 ? 255 : R);
    }
}

// Convert full NV12 frame buffer to packed BGR (HWC, uint8).
// out_bgr must be pre-allocated to width * height * 3 bytes.
inline bool nv12_to_bgr(
    const uint8_t* nv12_buf,
    size_t         buf_size,
    int            width,
    int            height,
    uint8_t*       out_bgr)
{
    const size_t expected = static_cast<size_t>(width * height * 3 / 2);
    if (buf_size < expected) {
        std::cerr << "[Preprocessor] NV12 buffer too small: " << buf_size
                  << " < " << expected << std::endl;
        return false;
    }

    const uint8_t* y_plane  = nv12_buf;
    const uint8_t* uv_plane = nv12_buf + width * height;

    for (int row = 0; row < height; ++row) {
        nv12_to_bgr_row(y_plane, uv_plane, out_bgr + row * width * 3, row, width);
    }
    return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Letterbox + float32 conversion
//
// Letterbox-resizes src (HWC uint8 BGR) into a (INFER_H × INFER_W) canvas
// padded with PAD_VAL, then writes CHW float32 to out_tensor.
// out_tensor must be pre-allocated to INFER_H * INFER_W * 3 floats.
// Returns LetterboxParams so postprocessing can map detected boxes back to
// original frame coordinates.
// ──────────────────────────────────────────────────────────────────────────────

inline LetterboxParams letterbox_to_tensor(
    const uint8_t* src_bgr,
    int            src_w,
    int            src_h,
    float*         out_tensor)
{
    // Compute uniform scale
    float scale_w = static_cast<float>(INFER_W) / src_w;
    float scale_h = static_cast<float>(INFER_H) / src_h;
    float scale   = (scale_w < scale_h) ? scale_w : scale_h;

    int new_w = static_cast<int>(std::round(src_w * scale));
    int new_h = static_cast<int>(std::round(src_h * scale));

    int pad_top  = (INFER_H - new_h) / 2;
    int pad_left = (INFER_W - new_w) / 2;

    // Fill entire canvas with PAD_VAL (flat fill, then overwrite scaled region)
    // CHW layout: plane B [0], plane G [1], plane R [2]
    const int plane = INFER_W * INFER_H;
    std::fill(out_tensor,          out_tensor + plane,     PAD_VAL);
    std::fill(out_tensor + plane,  out_tensor + 2 * plane, PAD_VAL);
    std::fill(out_tensor + 2*plane,out_tensor + 3 * plane, PAD_VAL);

    // Simple nearest-neighbour resize and write into the padded canvas
    for (int dy = 0; dy < new_h; ++dy) {
        int sy = static_cast<int>((dy + 0.5f) / scale - 0.5f);
        if (sy < 0) sy = 0;
        if (sy >= src_h) sy = src_h - 1;

        const uint8_t* src_row = src_bgr + sy * src_w * 3;

        int canvas_y = pad_top + dy;
        if (canvas_y < 0 || canvas_y >= INFER_H) continue;

        for (int dx = 0; dx < new_w; ++dx) {
            int sx = static_cast<int>((dx + 0.5f) / scale - 0.5f);
            if (sx < 0) sx = 0;
            if (sx >= src_w) sx = src_w - 1;

            int canvas_x = pad_left + dx;
            if (canvas_x < 0 || canvas_x >= INFER_W) continue;

            float b = src_row[sx * 3 + 0];
            float g = src_row[sx * 3 + 1];
            float r = src_row[sx * 3 + 2];

            // CHW: B-plane, G-plane, R-plane
            out_tensor[0 * plane + canvas_y * INFER_W + canvas_x] = b;
            out_tensor[1 * plane + canvas_y * INFER_W + canvas_x] = g;
            out_tensor[2 * plane + canvas_y * INFER_W + canvas_x] = r;
        }
    }

    return LetterboxParams{scale, pad_top, pad_left, src_w, src_h};
}

// ──────────────────────────────────────────────────────────────────────────────
// Main entry point used by InferenceEngine::run_inference()
//
// Converts a VideoFrame (NV12 from VDO, or pre-filled BGR in host mode) into
// a CHW float32 tensor ready for Larod.  Writes LetterboxParams so the caller
// can unproject detected boxes back to the original frame.
//
// Returns false if the frame buffer is empty or conversion fails.
// Never generates synthetic pixel data.
// ──────────────────────────────────────────────────────────────────────────────

inline bool preprocess_frame(
    const VideoFrame&  frame,
    float*             out_tensor,    // must hold INFER_W * INFER_H * 3 floats
    LetterboxParams&   out_params)
{
    if (frame.width <= 0 || frame.height <= 0) {
        std::cerr << "[Preprocessor] Invalid frame dimensions: "
                  << frame.width << "x" << frame.height << std::endl;
        return false;
    }

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    // VDO delivers NV12 on all current ARTPEC-6/7/8 hardware.
    // buffer must contain a complete NV12 frame (Y + interleaved UV).
    if (frame.buffer.empty()) {
        std::cerr << "[Preprocessor] VDO frame buffer is empty on frame "
                  << frame.frame_index << std::endl;
        return false;
    }

    // Allocate temporary BGR buffer
    std::vector<uint8_t> bgr(frame.width * frame.height * 3);
    if (!nv12_to_bgr(frame.buffer.data(), frame.buffer.size(),
                     frame.width, frame.height, bgr.data())) {
        return false;
    }

    out_params = letterbox_to_tensor(bgr.data(), frame.width, frame.height, out_tensor);
    return true;

#else
    // Host mode: buffer is expected to be pre-filled with BGR uint8 HWC data
    // (used by test harness / benchmarks / simulation runs).
    if (frame.buffer.empty()) {
        // In host mode with no buffer data, write a grey (PAD_VAL) tensor
        // for structure validation — still NOT synthetic detection data.
        const int num = INFER_W * INFER_H * 3;
        std::fill(out_tensor, out_tensor + num, PAD_VAL);
        out_params = LetterboxParams{1.0f, 0, 0, frame.width, frame.height};
        std::cout << "[Preprocessor] Host mode: no pixel data in frame "
                  << frame.frame_index << " — grey pad tensor (inference will produce no detections)" << std::endl;
        return true;
    }

    out_params = letterbox_to_tensor(frame.buffer.data(),
                                     frame.width, frame.height, out_tensor);
    return true;
#endif
}

// ──────────────────────────────────────────────────────────────────────────────
// Coordinate unproject: maps a normalized output box [x,y,w,h in INFER space]
// back to normalized frame coordinates using the LetterboxParams.
//
// Input coords are in pixel space of the (INFER_W × INFER_H) tensor.
// Output coords are normalized [0,1] relative to the original frame.
// ──────────────────────────────────────────────────────────────────────────────

inline void unproject_box(
    float  infer_x, float  infer_y, float  infer_w, float  infer_h,
    const LetterboxParams& lp,
    float& out_x,   float& out_y,   float& out_w,   float& out_h)
{
    // Un-pad and un-scale from tensor coords → original pixel coords
    float orig_x1 = (infer_x - lp.pad_left) / lp.scale;
    float orig_y1 = (infer_y - lp.pad_top)  / lp.scale;
    float orig_w  = infer_w / lp.scale;
    float orig_h  = infer_h / lp.scale;

    // Normalize to [0,1] frame coords
    out_x = orig_x1 / lp.src_w;
    out_y = orig_y1 / lp.src_h;
    out_w = orig_w  / lp.src_w;
    out_h = orig_h  / lp.src_h;

    // Clamp
    if (out_x < 0.0f)        out_x = 0.0f;
    if (out_y < 0.0f)        out_y = 0.0f;
    if (out_x + out_w > 1.0f) out_w = 1.0f - out_x;
    if (out_y + out_h > 1.0f) out_h = 1.0f - out_y;
}

} // namespace CamAI

#endif // CAMAI_PREPROCESSOR_HPP
