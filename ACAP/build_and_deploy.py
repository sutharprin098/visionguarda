#!/usr/bin/env python3
"""
CamAI ACAP EAP Builder - Deploy to Portal
Builds correct EAP for armv7hf and copies to portal downloads folder.

Fixes applied:
1. USTAR format (busybox tar compatible)
2. ./ prefix on all file names (busybox tar extracts with ./ prefix)
3. ELF e_flags = 0x05000400 (EABI v5 + HARD-FLOAT for armv7hf)
4. app name = camai_acap (matches portal URL)
5. All required files at root level: manifest.json, package.conf, param.conf, executable
"""
import tarfile, io, json, struct, os, sys, shutil

PORTAL_DOWNLOADS = r'd:\camAI\portal\public\downloads'


def make_arm32_elf_hardfloat():
    """Valid ARMv7 ELF32 LE, HARD-FLOAT ABI (e_flags=0x05000400), exit(0)."""
    code = bytes([
        0x01, 0x70, 0xa0, 0xe3,  # mov r7, #1  (SYS_exit)
        0x00, 0x00, 0xa0, 0xe3,  # mov r0, #0  (exit code)
        0x00, 0x00, 0x00, 0xef,  # svc 0
    ])
    ENTRY  = 0x00010054
    FILESZ = 52 + 32 + len(code)
    ehdr = struct.pack(
        '<4sBBBBBxxxxxxx' 'HHIIIIIHHHHHH',
        b'\x7fELF', 1, 1, 1, 0, 0,
        2, 0x28, 1, ENTRY, 0x34, 0,
        0x05000400,   # e_flags: EABI v5 + HARD-FLOAT (armv7hf)
        52, 32, 1, 64, 0, 0
    )
    phdr = struct.pack('<IIIIIIII', 1, 0, 0x00010000, 0x00010000, FILESZ, FILESZ, 0x5, 0x1000)
    pad  = ENTRY - 0x10000 - 52 - 32
    return ehdr + phdr + b'\x00' * pad + code


def add_file(tf, name, data, mode):
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


def build_eap(app='camai_acap', arch='armv7hf', ver='1.0.0',
              vendor='CamAI Enterprise', vid='1234567890'):
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

    pkgconf_data = '\n'.join([
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
        '',
    ]).encode()

    param_data = b'# CamAI parameters\n'
    elf_data   = make_arm32_elf_hardfloat()

    # ./ prefix required for busybox tar compatibility
    entries = [
        ('./manifest.json', manifest_data, 0o644),
        ('./package.conf',  pkgconf_data,  0o644),
        ('./param.conf',    param_data,    0o644),
        ('./' + app,        elf_data,      0o755),
    ]

    print('[*] Building %s_%s_%s_%s.eap' % (app, major, minor, micro))
    for name, data, mode in entries:
        print('    %-28s  %5d bytes  mode=%04o' % (name, len(data), mode))

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz', format=tarfile.USTAR_FORMAT) as tf:
        for name, data, mode in entries:
            add_file(tf, name, data, mode)
    return buf.getvalue()


def main():
    # Build armv7hf EAP with app name camai_acap (matches portal URL)
    eap_data = build_eap(app='camai_acap', arch='armv7hf')

    acap_dir = os.path.dirname(os.path.abspath(__file__))

    # Save to ACAP dir
    local_path = os.path.join(acap_dir, 'camai_acap_1_0_0_armv7hf.eap')
    with open(local_path, 'wb') as f:
        f.write(eap_data)
    print('\n[1] Saved locally: %s (%d bytes)' % (local_path, len(eap_data)))

    # Deploy to portal downloads
    portal_path = os.path.join(PORTAL_DOWNLOADS, 'camai_acap_1_0_0_armv7hf.eap')
    with open(portal_path, 'wb') as f:
        f.write(eap_data)
    print('[2] Deployed to portal: %s' % portal_path)

    # Verify
    with tarfile.open(local_path, 'r:gz') as tf:
        members = tf.getnames()
    print('\n[VERIFY] Members:')
    for m in members:
        print('         %s' % m)

    expected = {'./manifest.json', './package.conf', './param.conf', './camai_acap'}
    missing  = expected - set(members)
    if missing:
        print('\n[FAIL] Missing: %s' % missing)
        return 1

    # ELF check
    with __import__('gzip').open(local_path, 'rb') as g:
        raw = g.read()
    idx = raw.find(b'\x7fELF')
    if idx >= 0:
        e_flags = struct.unpack_from('<I', raw, idx + 36)[0]
        is_hard = bool(e_flags & 0x400)
        print('\n[ELF] e_flags=0x%08X hard-float=%s arch=EM_ARM(0x%02X)' % (
            e_flags, is_hard,
            struct.unpack_from('<H', raw, idx + 18)[0]))

    print('\n[SUCCESS] EAP deployed! Upload camai_acap_1_0_0_armv7hf.eap to camera.')
    print('          File: ' + local_path)
    return 0


if __name__ == '__main__':
    sys.exit(main())
