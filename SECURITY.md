# Security Policy

FlowGuard is a financial data platform – security is a top priority. We appreciate your help in keeping the project safe.

---

## 🛡️ Supported Versions

We actively maintain the latest major release. Security patches are backported to the latest minor version.

| Version | Supported |
|---------|-----------|
| 2.0.x   | ✅ Yes    |
| 1.0.x   | ❌ No     |

> Always use the latest stable release to benefit from security updates.

---

## 📬 Reporting a Vulnerability

If you discover a security vulnerability, **please do not open a public issue**. Instead, send a detailed report to:

**Email:** `security@nullterminators.com` *(replace with your actual email)*

We aim to respond within **48 hours** and will work with you to confirm the issue, plan a fix, and coordinate a disclosure timeline.

### What to include in your report
- A clear description of the vulnerability and its impact
- Steps to reproduce (or proof-of-concept code)
- Affected versions
- Any potential mitigations or workarounds you’ve identified

---

## 🔒 Security Best Practices (for users)

- **Never commit secrets** (`.env`, `SECRET_KEY`, database credentials) to Git.
- Always use strong, unique `SECRET_KEY` values (generate with `openssl rand -hex 32`).
- Use **HTTPS** in production – all deployment examples use SSL.
- Keep dependencies up-to-date – run `pip list --outdated` regularly.
- Restrict database access to trusted IPs and use strong passwords.
- Enable audit trails (FlowGuard logs all critical actions by default).

---

## 🔐 Platform Security Features

FlowGuard includes several built-in security mechanisms:

| Feature | Description |
|---------|-------------|
| **JWT Authentication** | All API endpoints (except login/register/webhook) require a valid bearer token. Tokens have a configurable expiry. |
| **RBAC** | Granular role-based permissions – users only access data and actions they are authorised for. |
| **Forced Password Reset** | New users receive a temporary password; they must reset it on first login. |
| **Consent Tracking** | Terms & Conditions and Privacy Policy consent is recorded for every user (GDPR/DPA compliant). |
| **Immutable Audit Trail** | All user actions and ETL ingestion events are logged in a hash‑chain – optional on‑chain anchoring. |
| **Secure Environment Variables** | All secrets are stored in environment variables or platform secrets (GitHub Actions, Fly.io, Render). |
| **CORS** | Strict CORS configuration – only allowed origins can access the API. |
| **SQL Injection Protection** | SQLAlchemy ORM with parameterised queries prevents injection. |
| **Input Validation** | Pydantic models validate all API payloads. |

---

## 🔄 Reporting Policy

- We will acknowledge receipt of your report within 48 hours.
- We will confirm the issue and provide an estimated timeline for a fix.
- Once fixed, we will credit the reporter (if desired) in the release notes.

---

## 🏷️ Responsible Disclosure

We ask that you:
- **Do not publicly disclose** the vulnerability until we have released a fix.
- **Do not exploit** the vulnerability beyond the minimum needed to demonstrate it.
- **Do not use** automated scanners or denial-of-service attacks.

---

## 📦 Dependency Security

We use Dependabot (GitHub) to monitor and automatically update vulnerable dependencies. All pull requests are tested by CI before merging.

---

## ✉️ Contact

For general security questions or to report a vulnerability:

📧 **security@nullterminators.com** *(replace with your actual email)*

---

**Thank you for helping keep FlowGuard secure!** 🔒
