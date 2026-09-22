#!/usr/bin/env python3
"""
CamAI ACAP EAP Builder - DEFINITIVE FIX
Analysis of camera system logs:
  - USTAR format fixed 'tar: manifest.json not found' ✓
  - 'acapctl error 50: File is missing' remains
  
Root cause of error 50:
  busybox tar on camera stores/lists files with './' prefix.
  acapctl does: tar -xf pkg.eap ./camai_edge
  Our file is named 'camai_edge' (no ./), so it's NOT found → error 50.
  
Fix:
  1. Name ALL files with './' prefix: './manifest.json', './camai_edge', etc.
  2. Fix ELF e_flags: armv7hf needs HARD-FLOAT flag (0x05000400, not 0x05000200)
"""
import tarfile, io, json, struct, os, sys

def make_arm32_elf_hardfloat():
    """
    Valid ARMv7 ELF32 LE with HARD-FLOAT ABI flags (armv7hf).
    e_flags = EF_ARM_ABI_VER5 (0x05000000) | EF_ARM_ABI_FLOAT_HARD (0x00000400)
    """
    code = bytes([
        0x01, 0x70, 0xa0, 0xe3,  # mov r7, #1  (SYS_exit)
        0x00, 0x00, 0xa0, 0xe3,  # mov r0, #0  (exit code 0)
        0x00, 0x00, 0x00, 0xef,  # svc 0
    ])
    ENTRY  = 0x00010054
    FILESZ = 52 + 32 + len(code)  # ehdr + phdr + code (no padding needed since ENTRY-0x10000=84=ehdr+phdr)
    ehdr = struct.pack(
        '<4sBBBBBxxxxxxx' 'HHIIIIIHHHHHH',
        b'\x7fELF',  # magic
        1,           # EI_CLASS = ELFCLASS32
        1,           # EI_DATA  = ELFDATA2LSB (little-endian)
        1,           # EI_VERSION
        0,           # EI_OSABI = ELFOSABI_NONE
        0,           # EI_ABIVERSION
        2,           # e_type    = ET_EXEC
        0x28,        # e_machine = EM_ARM (40)
        1,           # e_version = EV_CURRENT
        ENTRY,       # e_entry
        0x34,        # e_phoff   = 52 (right after ehdr)
        0,           # e_shoff   = 0 (no sections)
        0x05000400,  # e_flags   = EABI v5 + HARD-FLOAT (armv7hf!)
        52,          # e_ehsize
        32,          # e_phentsize
        1,           # e_phnum
        64,          # e_shentsize
        0,           # e_shnum
        0,           # e_shstrndx
    )
    phdr = struct.pack(
        '<IIIIIIII',
        1,           # p_type  = PT_LOAD
        0,           # p_offset = 0
        0x00010000,  # p_vaddr
        0x00010000,  # p_paddr
        FILESZ,      # p_filesz
        FILESZ,      # p_memsz
        0x5,         # p_flags = PF_R | PF_X (read + execute, no write)
        0x1000,      # p_align
    )
    # ENTRY is at 0x10054, ehdr+phdr ends at 0x10000+52+32=0x10054, so NO padding needed
    pad_len = ENTRY - 0x10000 - len(ehdr) - len(phdr)
    return ehdr + phdr + b'\x00' * pad_len + code


def add_file(tf, name, data, mode):
    """Add bytes as a file to TarFile with explicit metadata."""
    info = tarfile.TarInfo(name=name)
    info.size  = len(data)
    info.mode  = mode
    info.uid   = 0
    info.gid   = 0
    info.uname = 'root'
    info.gname = 'root'
    info.mtime = 0
    info.type  = tarfile.REGTYPE
    tf.addfile(info, io.BytesIO(data))


def build_eap(arch='armv7hf'):
    app    = 'camai_edge'
    ver    = '1.0.0'
    vendor = 'CamAI Enterprise'
    vid    = '1234567890'
    major, minor, micro = ver.split('.')

    manifest_data = json.dumps({
        'schemaVersion': '2.2.0',
        'acapPackageConf': {
            'setup': {
                'appName':      app,
                'execName':     app,
                'vendor':       vendor,
                'vendorId':     vid,
                'version':      ver,
                'architecture': arch,
                'runMode':      'respawn',
            }
        }
    }, indent=2).encode()

    pkgconf_lines = [
        'PACKAGENAME="%s"' % app,
        'APPNAME="%s"' % app,
        'EXECNAME="%s"' % app,
        'APPID="%s"' % vid,
        'VENDORID="%s"' % vid,
        'APPTYPE="%s"' % arch,
        'MAJORVERSION="%s"' % major,
        'MINORVERSION="%s"' % minor,
        'MICROVERSION="%s"' % micro,
        'VENDOR="%s"' % vendor,
        'VENDORURL="https://camai.princesite.in"',
        'RUNMODE="respawn"',
    ]
    pkgconf_data = '\n'.join(pkgconf_lines).encode() + b'\n'
    param_data   = b'# CamAI Edge parameters\n'
    elf_data     = make_arm32_elf_hardfloat()

    # CRITICAL FIX: Use './' prefix on all files.
    # busybox tar lists/extracts files as './filename'.
    # acapctl runs: tar -xf pkg.eap ./manifest.json AND ./camai_edge
    # Without './', those extractions fail → error 50 "File is missing"
    entries = [
        ('./manifest.json', manifest_data, 0o644),
        ('./package.conf',  pkgconf_data,  0o644),
        ('./param.conf',    param_data,    0o644),
        ('./' + app,        elf_data,      0o755),
    ]

    print('[*] Building USTAR EAP with ./ prefix (busybox tar compatible):')
    for name, data, mode in entries:
        print('    %-24s  %5d bytes  mode %04o' % (name, len(data), mode))

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz', format=tarfile.USTAR_FORMAT) as tf:
        for name, data, mode in entries:
            add_file(tf, name, data, mode)
    eap = buf.getvalue()

    out_name = '%s_1_0_0_%s.eap' % (app, arch)
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), out_name)
    with open(out_path, 'wb') as f:
        f.write(eap)

    print('\n[SUCCESS] Written: %s  (%d bytes / %.1f KB)' % (out_path, len(eap), len(eap)/1024))

    # Verify
    with tarfile.open(out_path, 'r:gz') as tf:
        members = tf.getnames()
    print('\n[VERIFY] TAR members (as camera tar sees them):')
    for m in members:
        print('         [%s]' % m)

    # Check ELF flags
    import gzip as gz
    with gz.open(out_path, 'rb') as g:
        raw_tar = g.read()
    # Find ELF in tar (after header + ./manifest + ./package + ./param headers/data)
    elf_magic = b'\x7fELF'
    idx = raw_tar.find(elf_magic)
    if idx >= 0:
        e_flags = struct.unpack_from('<I', raw_tar, idx + 36)[0]
        float_abi = 'HARD-FLOAT' if (e_flags & 0x400) else 'SOFT-FLOAT'
        print('\n[ELF] e_flags = 0x%08X → %s (%s)' % (e_flags, float_abi, 'CORRECT for armv7hf' if (e_flags & 0x400) else 'WRONG! should be hard-float'))

    expected = {'./manifest.json', './package.conf', './param.conf', './' + app}
    missing  = expected - set(members)
    if missing:
        print('\n[FAIL] Missing: %s' % missing)
        return False
    print('\n[OK] Package ready. All files have ./ prefix, ELF is HARD-FLOAT armv7hf.')
    return True


if __name__ == '__main__':
    arch = sys.argv[1] if len(sys.argv) > 1 else 'armv7hf'
    ok = build_eap(arch)
    sys.exit(0 if ok else 1)
