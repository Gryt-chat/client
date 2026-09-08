/* eslint-env node */

/**
 * Whether a Windows binary carries an Authenticode signature. The interesting
 * failure is a signing tool that exits 0 and signs nothing.
 */

import { open } from "node:fs/promises";

/** Data directory entry 4 is the Certificate Table. */
const CERTIFICATE_TABLE_INDEX = 4;

/** PE32+ has wider fields before the data directory than PE32 does. */
const PE32_MAGIC = 0x10b;
const PE32_PLUS_MAGIC = 0x20b;

/**
 * Reads far enough into the file to find the data directory. 4096 bytes is
 * generous, and a fixed block keeps this to one read rather than four seeks.
 */
const HEADER_BYTES = 4096;

/**
 * @param {string} path
 * @returns {Promise<{ signed: boolean, offset: number, size: number }>}
 */

/**
 * Whether this file is a Windows binary at all: a `.node` prebuild can be ELF or
 * Mach-O, and handing one to a signing tool is a failed release.
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
 * Split out from the file read so a check can drive it with bytes it built.
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
 * Whether an MSIX package carries a signature. A .appx is a zip: signtool writes
 * an AppxSignature.p7x member, and the zip is walked, not substring-searched.
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

    // Both fields saturate at 0xffffffff and move into the zip64 record. An MSIX
    // with the embedded server is a quarter of a gigabyte, so this is close.
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
