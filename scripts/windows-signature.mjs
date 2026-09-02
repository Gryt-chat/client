/* eslint-env node */

/**
 * Whether a Windows binary actually carries an Authenticode signature.
 *
 * This exists because the interesting failure is not a signing tool that
 * errors. It is a signing tool that exits 0 and signs nothing — a missing
 * credential that a CLI treats as "nothing to do", a keypair alias that does
 * not match, a file the tool silently skipped. The build goes green, the
 * release ships, and the first person to find out is somebody whose Windows
 * refuses to run it.
 *
 * So the signing hook asks this afterwards rather than trusting an exit code.
 *
 * The check is the same one Windows makes when it decides whether a file is
 * signed at all: the Certificate Table in the PE optional header's data
 * directory, entry 4. Unsigned files have offset 0 and size 0 there. It says
 * nothing about whether the signature is valid or who issued it, which is the
 * operating system's job and needs the whole certificate chain — this only
 * answers "is there one", which is exactly the question that separates
 * "blocked by Smart App Control every time" from "judged on its merits".
 *
 * Verified against the real thing on 2026-09-02: Gryt-Chat-1.9.1-win-x64.exe
 * from the v1.9.1 release reads offset 0, size 0.
 */

import { open } from "node:fs/promises";

/** Data directory entry 4 is the Certificate Table. */
const CERTIFICATE_TABLE_INDEX = 4;

/** PE32+ has wider fields before the data directory than PE32 does. */
const PE32_MAGIC = 0x10b;
const PE32_PLUS_MAGIC = 0x20b;

/**
 * Reads far enough into the file to find the data directory.
 *
 * 4096 bytes is generous. The PE header sits within the first few hundred on
 * everything electron-builder produces, and reading a fixed block keeps this
 * to one read rather than four seeks.
 */
const HEADER_BYTES = 4096;

/**
 * @param {string} path
 * @returns {Promise<{ signed: boolean, offset: number, size: number }>}
 */
export async function readCertificateTable(path) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return parseCertificateTable(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/**
 * Split out from the file read so a check can drive it with bytes it built,
 * rather than needing a signed binary lying around to test against.
 *
 * @param {Buffer} header
 */
export function parseCertificateTable(header) {
  if (header.length < 64 || header[0] !== 0x4d || header[1] !== 0x5a) {
    throw new Error("Not a PE file: no MZ signature");
  }

  // e_lfanew, at 0x3c in the DOS header, points at the PE header.
  const peOffset = header.readUInt32LE(0x3c);
  if (peOffset + 24 > header.length) {
    throw new Error("Not a PE file: the PE header is past the bytes read");
  }
  if (header.toString("latin1", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error("Not a PE file: no PE signature");
  }

  // The optional header starts after the 24-byte COFF header, and its first
  // field says which of the two layouts follows.
  const optional = peOffset + 24;
  const magic = header.readUInt16LE(optional);

  let dataDirectory;
  if (magic === PE32_PLUS_MAGIC) {
    dataDirectory = optional + 112;
  } else if (magic === PE32_MAGIC) {
    dataDirectory = optional + 96;
  } else {
    throw new Error(`Not a PE file: unrecognised optional header magic 0x${magic.toString(16)}`);
  }

  const entry = dataDirectory + CERTIFICATE_TABLE_INDEX * 8;
  if (entry + 8 > header.length) {
    throw new Error("Not a PE file: the data directory is past the bytes read");
  }

  const offset = header.readUInt32LE(entry);
  const size = header.readUInt32LE(entry + 4);

  // Both, rather than either. A table with a size and no offset, or the other
  // way round, is not a signature and should not read as one.
  return { signed: offset > 0 && size > 0, offset, size };
}
