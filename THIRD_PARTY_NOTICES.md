# Third-party notices

The MIT licence in this repository applies to Orbit LAN's own code and assets. Dependencies are installed from npm and keep their respective licences. Review the installed package licence before redistributing bundled dependencies or binaries.

Direct runtime dependencies:

- [`@anthropic-ai/claude-agent-sdk`](https://github.com/anthropics/claude-agent-sdk-typescript) — vendor licence described by its package README / LICENSE; includes platform-specific Claude Code binaries.
- [`@peculiar/x509`](https://github.com/PeculiarVentures/x509) — MIT.
- [`reflect-metadata`](https://github.com/microsoft/reflect-metadata) — Apache-2.0.
- [`qrcode`](https://github.com/soldair/node-qrcode) — MIT.

Development dependencies:

- [`playwright-core`](https://github.com/microsoft/playwright) — Apache-2.0. The browser test uses a separately installed browser.
- [`prettier`](https://github.com/prettier/prettier) — MIT.

The dependency graph and resolved versions are recorded in `package-lock.json`. OpenAI, Anthropic, Apple and their product names belong to their respective owners; no affiliation or endorsement is implied.
