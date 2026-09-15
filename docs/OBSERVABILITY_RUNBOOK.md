# Observability runbook

Reconova exposes application telemetry for operators without coupling the user-facing FlowGuard interface to the monitoring stack.

## Local services

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001` (`admin` / the configured `GRAFANA_ADMIN_PASSWORD`)
- Alertmanager: `http://localhost:9093`
- API metrics: `http://localhost:8000/metrics`
- Liveness: `http://localhost:8000/health/live`
- Readiness: `http://localhost:8000/health/ready`

The API metrics cover request volume, status codes, and latency. Prometheus evaluates API availability, server-error rate, and readiness rules. Grafana provisions the Platform Health and API Activity dashboards automatically.

## Start and verify

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://localhost:8000/health/live
curl -fsS http://localhost:8000/health/ready
curl -fsS http://localhost:9090/-/ready
```

If the API is healthy but Grafana has no data, check the Prometheus target at `http://localhost:9090/targets` and confirm the `reconova-api` target is `UP`.

## Production handover

Use a secrets manager for Grafana credentials and alert receivers. Keep Prometheus and Grafana on the private operations network, retain metrics according to KPC policy, and forward alerts to the approved operations channel. Do not place beneficiary identity data in metric labels; metrics must remain aggregate and non-identifying.
