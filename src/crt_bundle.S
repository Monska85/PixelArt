// SPDX-License-Identifier: GPL-3.0-or-later

// The certificate bundle the board checks HTTPS servers with: Espressif's
// common bundle (certs/README.md) instead of the full one built into the
// framework. The framework's bundle code looks for these two symbols; with
// them defined here, the linker never takes the full bundle from libmbedtls.
#ifndef PIXELART_SIM
    .section .rodata.embedded
    .balign 4
    .global _binary_x509_crt_bundle_start
    .global _binary_x509_crt_bundle_end
_binary_x509_crt_bundle_start:
    .incbin "certs/x509_crt_bundle.bin"
_binary_x509_crt_bundle_end:
#endif
