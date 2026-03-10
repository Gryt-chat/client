#pragma once
// Minimal WebSocket server for streaming binary frames to a single local
// client.  Server-to-client only (no masking needed on outbound frames).

#include <winsock2.h>
#include <ws2tcpip.h>
#include <bcrypt.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#ifdef _MSC_VER
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "bcrypt.lib")
#endif

// ── SHA-1 (via BCrypt) ────────────────────────────────────────────────

static void sha1(const uint8_t* data, uint32_t len, uint8_t out[20]) {
    BCRYPT_ALG_HANDLE alg = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA1_ALGORITHM, nullptr, 0);
    BCryptCreateHash(alg, &hash, nullptr, 0, nullptr, 0, 0);
    BCryptHashData(hash, (PUCHAR)data, len, 0);
    BCryptFinishHash(hash, out, 20, 0);
    BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(alg, 0);
}

// ── Base-64 ───────────────────────────────────────────────────────────

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static int base64Encode(const uint8_t* in, int len, char* out) {
    int i, o = 0;
    for (i = 0; i + 2 < len; i += 3) {
        out[o++] = B64[in[i] >> 2];
        out[o++] = B64[((in[i]&3) << 4) | (in[i+1] >> 4)];
        out[o++] = B64[((in[i+1]&0xF) << 2) | (in[i+2] >> 6)];
        out[o++] = B64[in[i+2] & 0x3F];
    }
    if (i < len) {
        out[o++] = B64[in[i] >> 2];
        if (i+1 < len) {
            out[o++] = B64[((in[i]&3)<<4) | (in[i+1]>>4)];
            out[o++] = B64[((in[i+1]&0xF)<<2)];
        } else {
            out[o++] = B64[((in[i]&3)<<4)];
            out[o++] = '=';
        }
        out[o++] = '=';
    }
    out[o] = '\0';
    return o;
}

// ── Send a binary WebSocket frame ─────────────────────────────────────

static bool wsSendBinary(SOCKET sock, const uint8_t* data, size_t len) {
    uint8_t hdr[10];
    int hdrLen;
    hdr[0] = 0x82; // FIN + Binary opcode
    if (len < 126) {
        hdr[1] = (uint8_t)len;
        hdrLen = 2;
    } else if (len < 65536) {
        hdr[1] = 126;
        hdr[2] = (uint8_t)(len >> 8);
        hdr[3] = (uint8_t)(len);
        hdrLen = 4;
    } else {
        hdr[1] = 127;
        hdr[2] = 0; hdr[3] = 0; hdr[4] = 0; hdr[5] = 0;
        hdr[6] = (uint8_t)((len >> 24) & 0xFF);
        hdr[7] = (uint8_t)((len >> 16) & 0xFF);
        hdr[8] = (uint8_t)((len >> 8) & 0xFF);
        hdr[9] = (uint8_t)(len & 0xFF);
        hdrLen = 10;
    }

    if (send(sock, (const char*)hdr, hdrLen, 0) == SOCKET_ERROR) return false;

    size_t sent = 0;
    while (sent < len) {
        int chunk = (int)((len - sent) > 65536 ? 65536 : (len - sent));
        int r = send(sock, (const char*)data + sent, chunk, 0);
        if (r == SOCKET_ERROR) return false;
        sent += (size_t)r;
    }
    return true;
}

// ── WebSocket HTTP upgrade handshake ──────────────────────────────────

static const char WS_MAGIC[] = "258EAFA5-E914-47DA-95CA-5AB9E3F04890";

static bool wsHandshake(SOCKET client) {
    char reqBuf[4096];
    int total = 0;
    while (total < (int)sizeof(reqBuf) - 1) {
        int n = recv(client, reqBuf + total, (int)(sizeof(reqBuf) - 1 - total), 0);
        if (n <= 0) return false;
        total += n;
        reqBuf[total] = '\0';
        if (strstr(reqBuf, "\r\n\r\n")) break;
    }

    const char* keyHeader = strstr(reqBuf, "Sec-WebSocket-Key:");
    if (!keyHeader) keyHeader = strstr(reqBuf, "sec-websocket-key:");
    if (!keyHeader) return false;
    keyHeader += 18;
    while (*keyHeader == ' ') keyHeader++;
    char key[64];
    int ki = 0;
    while (keyHeader[ki] && keyHeader[ki] != '\r' && keyHeader[ki] != '\n' && ki < 63) {
        key[ki] = keyHeader[ki];
        ki++;
    }
    key[ki] = '\0';

    char concat[128];
    int concatLen = snprintf(concat, sizeof(concat), "%s%s", key, WS_MAGIC);
    uint8_t hash[20];
    sha1((const uint8_t*)concat, (uint32_t)concatLen, hash);
    char accept[64];
    base64Encode(hash, 20, accept);

    char response[512];
    int respLen = snprintf(response, sizeof(response),
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: %s\r\n\r\n", accept);

    return send(client, response, respLen, 0) != SOCKET_ERROR;
}

// ── Create TCP listener on loopback with an ephemeral port ────────────

static SOCKET wsListen(uint16_t* outPort) {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return INVALID_SOCKET;

    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return INVALID_SOCKET;

    struct sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0;

    if (bind(s, (struct sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        closesocket(s);
        return INVALID_SOCKET;
    }
    if (listen(s, 1) == SOCKET_ERROR) {
        closesocket(s);
        return INVALID_SOCKET;
    }

    int addrLen = sizeof(addr);
    getsockname(s, (struct sockaddr*)&addr, &addrLen);
    *outPort = ntohs(addr.sin_port);

    int bufSize = 32 * 1024 * 1024;
    setsockopt(s, SOL_SOCKET, SO_SNDBUF, (const char*)&bufSize, sizeof(bufSize));

    return s;
}
