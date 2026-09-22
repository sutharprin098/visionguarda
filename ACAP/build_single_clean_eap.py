#!/usr/bin/env python3
"""
CamAI ACAP Single Clean EAP Package Builder
Generates ONE clean, standard .eap file for AXIS M1137 (armv7hf, AXIS OS 10.12).
"""
import tarfile, io, json, struct, os, sys

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
    info.mtime = 1700000000
    info.type  = tarfile.REGTYPE
    tf.addfile(info, io.BytesIO(data))

def build_eap_for_arch(arch):
    app = 'camai_acap'
    ver = '1.0.0'
    vendor = 'CamAI Enterprise'
    vid = '1234567890'
    major, minor, micro = ver.split('.')

    manifest_data = json.dumps({
        'schemaVersion': '1.3',
        'acapPackageConf': {
            'setup': {
                'friendlyName':       'CamAI Edge',
                'appName':            app,
                'execName':           app,
                'vendor':             vendor,
                'vendorId':           vid,
                'version':            ver,
                'majorVersion':       major,
                'minorVersion':       minor,
                'microVersion':       micro,
                'architecture':       arch,
                'runMode':            'respawn',
                'embeddedSdkVersion': '3.0',
            },
            'configuration': {
                'settingPage':        'index.html'
            },
            'licensing': {
                'licenseType':        'free'
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
        'APPVERSION="%s"' % ver,
        'VERSION="%s"' % ver,
        'APPMAJORVERSION="%s"' % major,
        'APPMINORVERSION="%s"' % minor,
        'APPMICROVERSION="%s"' % micro,
        'MAJORVERSION="%s"' % major,
        'MINORVERSION="%s"' % minor,
        'MICROVERSION="%s"' % micro,
        'MAJOR="%s"' % major,
        'MINOR="%s"' % minor,
        'MICRO="%s"' % micro,
        'VENDOR="%s"' % vendor,
        'VENDORURL="https://camai.princesite.in"',
        'RUNMODE="respawn"',
        'LICENSETYPE="free"',
        'LICENSEPAGE="none"',
        'SETTINGSPAGEFILE="index.html"',
        'SETTINGPAGE="index.html"',
        'APPURL="index.html"',
        'STARTPAGE="index.html"',
        'HTTPCGIPATH="html"',
        'APPUSR="root"',
        'APPGROUP="root"',
        '',
    ]).encode()

    param_data = b'# CamAI parameters\n'
    license_data = b'No licenses\n'
    
    shell_script = (
        '#!/bin/sh\n'
        '# CamAI ACAP Engine for Axis M1137\n'
        'logger -t "camai_acap" "CamAI ACAP Native Service Started Successfully"\n'
        'while true; do\n'
        '    sleep 30\n'
        'done\n'
    ).encode()

    entries = [
        ('manifest.json',           manifest_data, 0o644),
        ('package.conf',            pkgconf_data,  0o644),
        ('param.conf',              param_data,    0o644),
        ('LICENSE',                 license_data,  0o644),
        ('camai_acap_LICENSE.txt',  license_data,  0o644),
        (app,                       shell_script,  0o755),
    ]

    html_dir = os.path.join(os.path.dirname(__file__), 'html')
    if os.path.exists(html_dir):
        for root, dirs, files in os.walk(html_dir):
            for file in files:
                abs_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_path, html_dir).replace('\\', '/')
                with open(abs_path, 'rb') as hf:
                    file_data = hf.read()
                entries.append((f'html/{rel_path}', file_data, 0o644))
                if rel_path == 'index.html':
                    entries.append(('index.html', file_data, 0o644))

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz', format=tarfile.USTAR_FORMAT) as tf:
        for name, data, mode in entries:
            add_file(tf, name, data, mode)
    
    eap_bytes = buf.getvalue()
    filename = f'{app}_{ver.replace(".", "_")}_{arch}.eap'

    dest_dirs = [
        r'd:\camAI\ACAP',
        r'd:\camAI\portal\public\downloads',
        r'd:\camAI\portal\dist\downloads',
        r'd:\camAI\overview_site\downloads',
    ]

    for d in dest_dirs:
        if os.path.exists(d):
            fp = os.path.join(d, filename)
            with open(fp, 'wb') as f:
                f.write(eap_bytes)
            print(f" -> Deployed: {fp}")

    print(f"[SUCCESS] Built: {filename} ({len(eap_bytes)} bytes)")

def main():
    print("=== Building Clean ACAP Packages ===")
    for arch in ['armv7hf', 'aarch64']:
        build_eap_for_arch(arch)

    # Verify primary M1137 package
    primary = os.path.join(r'd:\camAI\ACAP', 'camai_acap_1_0_0_armv7hf.eap')
    print("\nVerifying primary AXIS M1137 package:")
    with tarfile.open(primary, 'r:gz') as tf:
        for m in tf.getmembers():
            print(f"  - {m.name} ({m.size} bytes, mode={oct(m.mode)})")

if __name__ == '__main__':
    main()
