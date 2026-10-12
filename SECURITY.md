# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities privately through GitHub: open the
**Security** tab of this repository and choose **Report a vulnerability** to
file a draft security advisory. Do not open a public issue for a vulnerability.

Please include:

- A description of the vulnerability and its impact
- The affected version (release tag or commit SHA)
- Steps to reproduce, or a proof of concept
- A suggested fix, if you have one

Reports are acknowledged as time allows. This is a personal open-source project
without an SLA, but security reports are prioritized over other work.

## Scope

This repository contains a GitHub Action that delegates work from GitHub to
Factory Droid through the Sessions API.

- **In scope:** the action's own code (`src/`, bundled into `dist/`), the
  workflows under `examples/`, and the authorization, trigger-parsing and
  prompt-construction logic described in the
  [Security section of the README](./README.md#security).
- **Out of scope:** the Factory platform itself (the Sessions API, Droid
  Computers and the Droid agent). Please report those to Factory through their
  own channels.

When reporting, keep in mind the action's documented security model: Droid runs
unattended with `autonomy-level: high` on the user's own Droid Computer and
writes to GitHub with the computer's credentials. Behaviors that follow from a
user's own configuration choices (for example, enabling `permission-fallback`)
are not vulnerabilities by themselves, but ways to bypass those checks are.
