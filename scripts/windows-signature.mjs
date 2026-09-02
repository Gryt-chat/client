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
/**
 * Whether this file is a Windows binary at all.
 *
 * Extensions are not the answer. `.node` is a Node addon on every platform, and
 * a package that ships prebuilds — `uiohook-napi` does — carries the Linux and
 * macOS ones into a Windows build alongside the Windows one. Those are ELF and
 * Mach-O, and handing one to a signing tool, or to the reader below, is a
 * failed release rather than an unsigned file.
 *
 * @param {string} path
 * @returns {Promise<boolean>}
 */
export async function isPortableExecutable(path) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(2);
    const { bytesRead } = await handle.read(buffer, 0, 2, 0);
    return bytesRead === 2 && buffer[0] === 0x4d && buffer[1] === 0x5a;
  } finally {
    await handle.close();
  }
}

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

/*
 * Whether an MSIX package carries a signature.
 *
 * A .appx or .msix is a zip, not a PE file, so the reader above says nothing
 * useful about one. signtool signs it by writing an AppxSignature.p7x member
 * into the package, and Windows looks for exactly that: no member, no
 * signature, and the installer refuses the package outright rather than
 * warning about it the way it does for an unsigned .exe.
 *
 * The zip is walked rather than searched for the name as a substring. A member
 * called `app\AppxSignature.p7x` — inside the payload, where the app's own
 * files live — would match a substring search and is not a package signature.
 */

/** End of central directory record, and the most it can be preceded by. */
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;

/** 22 bytes of record plus the 65535-byte comment it is allowed to carry. */
const EOCD_SEARCH_BYTES = 22 + 0xffff;

/** The name signtool writes, at the package root. */
const APPX_SIGNATURE_MEMBER = "AppxSignature.p7x";

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
export async function hasAppxSignature(path) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, EOCD_SEARCH_BYTES);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);

    // Backwards, because the comment is allowed to contain anything — including
    // the bytes of another end-of-central-directory record.
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) {
      throw new Error(`Not a zip: no end of central directory in ${path}`);
    }

    let directorySize = tail.readUInt32LE(eocd + 12);
    let directoryOffset = tail.readUInt32LE(eocd + 16);

    // Both fields saturate at 0xffffffff and move into the zip64 record when
    // the package outgrows them. An MSIX with the embedded server in it is a
    // quarter of a gigabyte, so this is closer than it looks.
    if (directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      let locator = -1;
      for (let i = eocd - 20; i >= 0; i--) {
        if (tail.readUInt32LE(i) === ZIP64_LOCATOR_SIGNATURE) {
          locator = i;
          break;
        }
      }
      if (locator === -1) {
        throw new Error(`Not a zip: the central directory needs zip64 and ${path} has none`);
      }

      const zip64Offset = Number(tail.readBigUInt64LE(locator + 8));
      const zip64 = Buffer.alloc(56);
      await handle.read(zip64, 0, 56, zip64Offset);
      directorySize = Number(zip64.readBigUInt64LE(40));
      directoryOffset = Number(zip64.readBigUInt64LE(48));
    }

    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directorySize, directoryOffset);

    // Record by record, so the name is read from where the name actually is.
    let at = 0;
    while (at + 46 <= directory.length) {
      if (directory.readUInt32LE(at) !== CENTRAL_FILE_SIGNATURE) break;

      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const name = directory.toString("latin1", at + 46, at + 46 + nameLength);

      if (name === APPX_SIGNATURE_MEMBER) return true;

      at += 46 + nameLength + extraLength + commentLength;
    }

    return false;
  } finally {
    await handle.close();
  }
}
