#!/usr/bin/env python3
"""
CamAI ACAP EAP Builder - FIXED
Root cause from system log:
  acapctl error 50: File is missing  -> exec binary not in tar
  tar: manifest.json: not found       -> tar path prefix wrong
  Could not source package.conf       -> bad format
"""
import os, sys, gzip, struct, io, json, tarfile

def make_arm32_elf():
    # ARM32 exit(0): mov r7,#1 / mov r0,#0 / svc 0
    code = bytes([0x01,0x70,0xa0,0xe3,
                  0x00,0x00,0xa0,0xe3,
                  0x00,0x00,0x00,0xef])
    ENTRY  = 0x00010054
    FILESZ = 0x54 + 0x20 + len(code)
    # ELF32 little-endian header
    ehdr = struct.pack('<4sBBBBBxxxxxxx' 'HHIIIIIHHHHHH',
        b'\x7fELF', 1, 1, 1, 0, 0,
        2, 0x28, 1, ENTRY, 0x34, 0, 0x05000200,
        52, 32, 1, 64, 0, 0)
    # PT_LOAD program header
    phdr = struct.pack('<IIIIIIII',
        1, 0, 0x00010000, 0x00010000,
        FILESZ, FILESZ, 7, 0x1000)
    pad_len = ENTRY - 0x10000 - len(ehdr) - len(phdr)
    return ehdr + phdr + b'\x00' * pad_len + code


def tar_header(name, size, mode):
    h = bytearray(512)
    nb = name.encode('ascii')[:100]
    h[0:len(nb)] = nb
    def put(off, s):
        b = s.encode('ascii')
        h[off:off+len(b)] = b
    put(100, '%07o\x00' % mode)
    put(108, '0000000\x00')
    put(116, '0000000\x00')
    put(124, '%011o\x00' % size)
    put(136, '00000000000\x00')
    put(148, '        ')
    h[156] = ord('0')
    put(257, 'ustar\x0000')
    put(265, 'root')
    put(297, 'root')
    chk = sum(h)
    put(148, '%06o\x00 ' % chk)
    return bytes(h)


def tar_entry(name, data, mode):
    hdr = tar_header(name, len(data), mode)
    pad = (512 - len(data) % 512) % 512
    return hdr + data + b'\x00' * pad


def build_eap(arch='armv7hf'):
    app    = 'camai_edge'
    ver    = '1.0.0'
    vendor = 'CamAI Enterprise'
    vid    = '1234567890'
    major, minor, micro = ver.split('.')

    manifest = json.dumps({
        'schemaVersion': '2.2.0',
        'acapPackageConf': {
            'setup': {
                'appName':      app,
                'execName':     app,
                'vendor':       vendor,
                'vendorId':     vid,
                'version':      ver,
                'architecture': arch,
                'runMode':      'respawn'
            }
        }
    }, indent=2).encode()

    pkgconf = (
        'PACKAGENAME="{app}"\n'
        'APPNAME="{app}"\n'
        'EXECNAME="{app}"\n'
        'APPID="{vid}"\n'
        'VENDORID="{vid}"\n'
        'APPTYPE="{arch}"\n'
        'MAJORVERSION="{major}"\n'
        'MINORVERSION="{minor}"\n'
        'MICROVERSION="{micro}"\n'
        'VENDOR="{vendor}"\n'
        'VENDORURL="https://camai.princesite.in"\n'
        'RUNMODE="respawn"\n'
    ).format(app=app, vid=vid, arch=arch,
             major=major, minor=minor, micro=micro,
             vendor=vendor).encode()

    param = b'# CamAI Edge parameters\n'
    elf   = make_arm32_elf()

    print('[*] Building EAP with entries:')
    raw_tar = b''
    entries = [
        ('manifest.json', manifest, 0o644),
        ('package.conf',  pkgconf,  0o644),
        ('param.conf',    param,    0o644),
        (app,             elf,      0o755),
    ]
    for name, data, mode in entries:
        raw_tar += tar_entry(name, data, mode)
        print('    +  %-20s  %d bytes  mode %04o' % (name, len(data), mode))
    raw_tar += b'\x00' * 1024

    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode='wb', mtime=0) as gz:
        gz.write(raw_tar)
    eap = buf.getvalue()

    out_name = '%s_1_0_0_%s.eap' % (app, arch)
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), out_name)
    with open(out_path, 'wb') as f:
        f.write(eap)

    print('\n[SUCCESS] Written: %s  (%d bytes / %.1f KB)' % (out_path, len(eap), len(eap)/1024))

    # Self-verify
    with tarfile.open(out_path, 'r:gz') as tf:
        members = tf.getnames()
    print('\n[VERIFY] TAR members:')
    for m in members:
        print('         ' + m)

    expected = {'manifest.json', 'package.conf', 'param.conf', app}
    missing  = expected - set(members)
    if missing:
        print('\n[FAIL] Missing from tar: ' + str(missing))
        return False
    print('\n[OK] All required files present in tar. Upload this file to camera.')
    return True


if __name__ == '__main__':
    arch = sys.argv[1] if len(sys.argv) > 1 else 'armv7hf'
    ok = build_eap(arch)
    sys.exit(0 if ok else 1)
