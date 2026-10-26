# SPDX-License-Identifier: GPL-3.0-or-later
"""Checks of the certificate bundle the firmware embeds (certs/README.md): the
GitHub Pages chain saved in certs/ must verify against one of its roots, offline."""

import os
import struct
import unittest

import crt_bundle

try:
    from cryptography import x509
    from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
    from cryptography.hazmat.primitives.serialization import load_der_public_key
except ImportError:  # CI installs it from requirements-ci.txt
    x509 = None

CHAIN = crt_bundle.ROOT / "certs" / "github-pages-chain.pem"


def verify_signature(key, cert):
    if isinstance(key, rsa.RSAPublicKey):
        key.verify(cert.signature, cert.tbs_certificate_bytes, padding.PKCS1v15(), cert.signature_hash_algorithm)
    elif isinstance(key, ec.EllipticCurvePublicKey):
        key.verify(cert.signature, cert.tbs_certificate_bytes, ec.ECDSA(cert.signature_hash_algorithm))
    else:
        raise AssertionError("unexpected key type %s" % type(key).__name__)


class ReadBundleTest(unittest.TestCase):
    def test_reads_the_offsets_and_each_certificate(self):
        one = struct.pack("<HH", 2, 3) + b"ab" + b"xyz"
        two = struct.pack("<HH", 1, 1) + b"c" + b"k"
        data = struct.pack("<II", 8, 8 + len(one)) + one + two
        self.assertEqual(crt_bundle.read_bundle(data), [(b"ab", b"xyz"), (b"c", b"k")])

    def test_refuses_a_cut_bundle(self):
        one = struct.pack("<HH", 2, 3) + b"ab" + b"xyz"
        for data in [b"", struct.pack("<I", 0), struct.pack("<I", 8) + one, struct.pack("<I", 4) + one[:-1]]:
            with self.assertRaises(crt_bundle.BundleError, msg=data.hex()):
                crt_bundle.read_bundle(data)

    def test_check_accepts_the_committed_bundle_and_refuses_another(self):
        committed = crt_bundle.BUNDLE.read_bytes()
        crt_bundle.check(make=lambda path: path.write_bytes(committed))
        changed = bytearray(committed)
        changed[-1] ^= 1
        with self.assertRaisesRegex(crt_bundle.BundleError, "differs from certs/x509_crt_bundle.bin"):
            crt_bundle.check(make=lambda path: path.write_bytes(bytes(changed)))
        self.assertEqual(crt_bundle.BUNDLE.read_bytes(), committed)

    def test_the_committed_bundle_holds_the_common_roots(self):
        self.assertEqual(len(crt_bundle.read_bundle(crt_bundle.BUNDLE.read_bytes())), 43)


@unittest.skipIf(x509 is None and not os.environ.get("CI"), "needs the cryptography package")
class GitHubPagesChainTest(unittest.TestCase):
    def test_the_github_pages_chain_verifies_against_a_root_of_the_bundle(self):
        chain = x509.load_pem_x509_certificates(CHAIN.read_bytes())
        self.assertGreaterEqual(len(chain), 2)
        for cert, issuer in zip(chain, chain[1:]):
            self.assertEqual(cert.issuer, issuer.subject)
            verify_signature(issuer.public_key(), cert)
        top = chain[-1]
        keys = [key for name, key in crt_bundle.read_bundle(crt_bundle.BUNDLE.read_bytes()) if name == top.issuer.public_bytes()]
        self.assertTrue(keys, "no root of the bundle is named %s" % top.issuer.rfc4514_string())
        verify_signature(load_der_public_key(keys[0]), top)


if __name__ == "__main__":
    unittest.main()
