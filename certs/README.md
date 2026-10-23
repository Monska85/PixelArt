# Certificate bundle

The firmware checks every HTTPS server it reads from against the roots in `x509_crt_bundle.bin`: Espressif's common certificate bundle, the 43 roots listed in `cmn_crt_authorities.csv` of esp-idf, which cover nearly every public HTTPS site. It replaces the full bundle of 150 roots that the framework embeds (69 KB), and saves 51 KB of the firmware slot. `src/crt_bundle.S` embeds the file in place of the framework's bundle.

GitHub Pages, which serves the release manifest and its files, chains up to ISRG Root X1, which is in the bundle. `github-pages-chain.pem` holds the chain GitHub Pages sent when the bundle was made; `tools/test_crt_bundle.py`, run in CI, checks offline that this chain verifies against a root of the bundle. An animation source on another server must use a certificate from one of these roots.

## Regenerating the bundle

`python3 tools/crt_bundle.py regenerate` downloads three files from esp-idf at the tag the framework is built from (`v5.5.5`, from the `versions.txt` of the Arduino-ESP32 3.3.12 libraries), checks their SHA-256, and runs Espressif's generator on them:

- `gen_crt_bundle.py`, the generator,
- `cacrt_all.pem`, the Mozilla list of roots,
- `cmn_crt_authorities.csv`, the common roots to keep.

It needs the `cryptography` package of `requirements-ci.txt`. The output is reproducible: the same inputs give the same file, byte for byte. `python3 tools/crt_bundle.py check` makes the bundle the same way into a temporary folder and fails unless it is the committed `x509_crt_bundle.bin`, byte for byte; the `certificates` job of CI runs it on every change, so a bundle edited by hand, or made from other inputs, does not get in. It needs the network, as `regenerate` does.

Regenerate it when:

- Arduino-ESP32 moves to another esp-idf release: set `IDF_TAG` in `tools/crt_bundle.py` to that release's tag, download the three files from it (the URL pattern is `SOURCE_URL` in the script) and put their SHA-256 (`sha256sum`, or `shasum -a 256`) in `SOURCES`, then run the command. When the number of roots or the size of the bundle changes, update the count in `tools/test_crt_bundle.py` and the counts and sizes quoted in this file, `README.md`, `docs/board/wifi-and-updates-v1.md` and ADR 0005.
- GitHub Pages moves to another certificate chain, which boards show as `tls_error` (the CI checks read the saved chain and the pinned esp-idf files, so they cannot notice the move by themselves): save the chain GitHub Pages now sends (`openssl s_client -connect monska85.github.io:443 -servername monska85.github.io -showcerts`, the certificates only) in `github-pages-chain.pem` and run the tests, which tell whether its root is in the bundle; if it is not, the list itself has to change, which is a decision for the project.
