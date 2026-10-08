#!/usr/bin/env python3
"""Pads a Mach-O dylib's symbol string table to an 8-byte file offset.

Apple's ld in Xcode 27 can leave LC_SYMTAB's string pool at an offset that is
only 4-byte aligned, and the dyld of macOS 27 refuses such a library
("mis-aligned LINKEDIT string pool"), which rustc reports for a proc-macro as
"can't find crate". The string pool is the last thing in __LINKEDIT before the
code signature, so zero bytes are inserted in front of it, the offsets that
follow it are moved along, and the (ad-hoc) signature is redone.

Usage: realign.py <dylib>...   (a library that is already aligned is left alone)
"""
import struct, subprocess, sys

MH_MAGIC_64 = 0xFEEDFACF
LC_SEGMENT_64 = 0x19
LC_SYMTAB = 0x2
LC_CODE_SIGNATURE = 0x1D


def realign(path):
    data = bytearray(open(path, 'rb').read())
    magic, _cpu, _sub, _ft, ncmds, _size, _flags, _res = struct.unpack_from('<IiiIIIII', data, 0)
    if magic != MH_MAGIC_64:
        return f'{path}: not a 64-bit Mach-O'
    off = 32
    symtab = linkedit = codesig = None
    for _ in range(ncmds):
        cmd, cmdsize = struct.unpack_from('<II', data, off)
        if cmd == LC_SYMTAB:
            symtab = off
        elif cmd == LC_SEGMENT_64 and data[off + 8:off + 24].rstrip(b'\0') == b'__LINKEDIT':
            linkedit = off
        elif cmd == LC_CODE_SIGNATURE:
            codesig = off
        off += cmdsize
    if symtab is None or linkedit is None:
        return f'{path}: no LC_SYMTAB or __LINKEDIT'
    _, _, symoff, nsyms, stroff, strsize = struct.unpack_from('<IIIIII', data, symtab)
    pad = (-stroff) % 8
    if pad == 0:
        return f'{path}: already aligned'
    # nothing but the signature may follow the string pool
    if codesig is not None:
        _, _, dataoff, datasize = struct.unpack_from('<IIII', data, codesig)
        if dataoff < stroff + strsize:
            return f'{path}: the code signature precedes the string pool; not touching it'
    # insert the padding and move what follows
    data[stroff:stroff] = b'\0' * pad
    struct.pack_into('<I', data, symtab + 16, stroff + pad)
    # segment_command_64: vmaddr at +24, vmsize at +32, fileoff at +40, filesize at +48
    _vmaddr, vmsize, _fileoff, filesize = struct.unpack_from('<QQQQ', data, linkedit + 24)
    struct.pack_into('<Q', data, linkedit + 32, vmsize + pad)
    struct.pack_into('<Q', data, linkedit + 48, filesize + pad)
    if codesig is not None:
        struct.pack_into('<I', data, codesig + 8, dataoff + pad)
    open(path, 'wb').write(data)
    subprocess.run(['codesign', '--remove-signature', path], check=False, capture_output=True)
    subprocess.run(['codesign', '-s', '-', '-f', path], check=True, capture_output=True)
    return f'{path}: string pool moved from {stroff} to {stroff + pad}'


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(realign(p))
