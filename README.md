# QSOL-IMC GAMES

Native and browser-based games and interactive experiments from **QSOL-IMC**.

Every project is designed for local, offline play with no account or telemetry. Runtime and build requirements are documented per project.

## Games

| Game | Runtime | Status | Launch / build |
|---|---|---|---|
| [INERTIA ZERO](SUBSPACE/) | Offline browser | Playable | Open [`SUBSPACE/index.html`](SUBSPACE/index.html) |
| [TERNARY DRIFT](TERNARYDRIFT/) | Native C99/Win32 | Early native vertical slice | Build [`TERNARYDRIFT/`](TERNARYDRIFT/) with MinGW-w64; the packaged target is `TERNARY.EXE` + `README.TXT` under 1.44 MB |

## Running locally

- Browser projects: open the project's `index.html` directly in a modern desktop browser. No server is required.
- Native projects: follow the build and run instructions in the project's own README. Ternary Drift intentionally uses Win32, a software framebuffer, and `waveOut`; it contains no HTML, JavaScript, WebAssembly, SDL, or external game runtime.

## License

Code in this repository is available under the [MIT License](LICENSE). Individual projects may include additional independent-implementation or third-party notices in their own documentation.
