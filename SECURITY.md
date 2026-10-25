# Security policy

Orbit LAN grants access to local files and commands. Its security boundary is the selected private subnet, trusted local computer and explicitly paired devices. It is not a multi-user sandbox or an Internet-facing service.

## Trust model

- Plain HTTP from the LAN serves enrollment instructions and the public root certificate only. The desktop loopback HTTP endpoint is trusted and does not require pairing. Other processes and users with loopback access on the host are therefore trusted.
- Remote management uses TLS 1.2 or newer and a device cookie marked `HttpOnly`, `Secure` and `SameSite=Strict`. Token hashes are stored in SQLite. PINs expire after five minutes, rotate after use and have a per-address attempt limit.
- Host checks, subnet/interface checks, Origin validation and CSRF tokens are separate protections. They do not make an arbitrary reverse proxy safe.
- A paired device can access all approved roots, control Orbit-owned sessions and run shell commands as the host user. Pair only devices that may hold those privileges.
- File browsing resolves real paths, blocks traversal / NTFS streams / common secret paths and keeps links inside the approved root. This file-browser policy is separate from agent sandboxing and shell execution permissions.
- Agent approvals are presented to the user; unsupported protocol requests are rejected. Provider-level tool rules may allow operations without an additional prompt.
- Keys, databases, backups, transcripts and device state stay outside the repository. Service worker caches only public application assets. The local database and backups are not encrypted by Orbit.

## Deployment boundaries

Do not expose ports 8787/8788 directly to the public Internet. Internet access, including Tailscale Serve or Cloudflare Tunnel, requires a designed proxy/authentication boundary. Forwarding an external connection to the trusted loopback endpoint would otherwise inherit desktop trust.

The machine should use a trusted OS account and filesystem permissions. A compromised host, paired device or approved command is outside the protections provided by the web UI. Model providers still receive the context sent by their respective agents.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/kpk1310032003cy10-hue/orbit-lan/security/advisories/new). Include the affected commit, prerequisites and a minimal reproduction using synthetic files and credentials. Do not open a public issue with working tokens, private keys, transcripts or personal project paths.

Security fixes target the current `main` branch. No release currently has a long-term support commitment.
